#!/usr/bin/env bash
# Provision rs-ashburn-rehearsal, a twin of the scored run's host rs-ashburn-run, in us-east-1
# (cairn://p/rs/149; the run host is docs/speedrun/RUN-HOST.md, "The host"; this host's page is
# docs/speedrun/rehearsals/HOST.md).
#
#   bash docs/speedrun/scripts/rehearsal-host-provision.sh ['ssh-ed25519 AAAA... other-machine' ...]
#
# RS_RUN_HOST, the run host's public address (cairn://p/rs/host, never committed), finds the run
# host to copy; RUN_INSTANCE_ID=i-... instead names it directly.
#
# Runs on the Mac that holds the AWS profile (AWS_PROFILE_NAME, default bglab). It refuses, printing
# the existing instance's id and address, when an instance tagged Name=rs-ashburn-rehearsal already
# exists (pending, running, stopping or stopped): one twin at a time. The key pair, security group
# and Elastic IP are looked up by name and reused, so after a terminate (without releasing the
# address) a re-run builds a new twin at the same address. Ends with INSTANCE_ID=... PUBLIC_IP=...
#
# The run host is only READ (describe-* calls): its AMI, instance type, subnet (and so its AZ),
# root volume and security-group ingress are copied. Nothing here stops, modifies or tags it.
#
# Keys. ~/.rs-fleet/id_ed25519_rehearsal on this machine (created if missing) becomes the EC2 key
# pair. Each argument is another machine's public key (its own ~/.rs-fleet/id_ed25519_rehearsal.pub,
# literal text or a file path); cloud-init adds it to ubuntu's authorized_keys at first boot, so no
# private key ever moves between machines. ~/.rs-fleet/known_hosts_rehearsal is pinned from the
# host keys cloud-init prints to the instance console, never from a first connection. Copy that
# file (public keys only) to the other machines.
#
# RDP. The ubuntu user's password is generated into ~/.rs-fleet/rehearsal-rdp-password (mode 600)
# and set over ssh through stdin; it is never printed or passed as an argument.
#
# Next: rehearsal-host-setup.sh over ssh (HOST.md, "Setup").
set -euo pipefail

PROFILE=${AWS_PROFILE_NAME:-bglab}
REGION=us-east-1
NAME=rs-ashburn-rehearsal
RUN_NAME=rs-ashburn-run
RUN_IP=${RS_RUN_HOST:-}
KEY=$HOME/.rs-fleet/id_ed25519_rehearsal
KNOWN=$HOME/.rs-fleet/known_hosts_rehearsal
RDP_PW=$HOME/.rs-fleet/rehearsal-rdp-password

aws_() { aws --profile "$PROFILE" --region "$REGION" "$@"; }
die() { echo "provision: $*" >&2; exit 1; }
say() { echo "provision: $*"; }
umask 077
mkdir -p "$HOME/.rs-fleet"

read -r ID EIP <<<"$(aws_ ec2 describe-instances --filters "Name=tag:Name,Values=$NAME" \
    "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query 'Reservations[0].Instances[0].[InstanceId,PublicIpAddress]' --output text)"
if [ -n "$ID" ] && [ "$ID" != None ]; then
    say "refusing: $NAME already exists"
    echo "INSTANCE_ID=$ID PUBLIC_IP=$EIP"
    exit 1
fi

# --- The run host, read only -------------------------------------------------------------------
[ -n "${RUN_INSTANCE_ID:-}" ] || [ -n "$RUN_IP" ] || die "set RS_RUN_HOST from cairn://p/rs/host (or RUN_INSTANCE_ID)"
RUN_ID=${RUN_INSTANCE_ID:-$(aws_ ec2 describe-instances --filters "Name=ip-address,Values=$RUN_IP" \
    --query 'Reservations[].Instances[].InstanceId' --output text)}
[ -n "$RUN_ID" ] && [ "$RUN_ID" != None ] || die "cannot find $RUN_NAME ($RUN_IP); set RUN_INSTANCE_ID"
read -r AMI TYPE SUBNET AZ VPC RUN_ROOTDEV <<<"$(aws_ ec2 describe-instances --instance-ids "$RUN_ID" \
    --query 'Reservations[0].Instances[0].[ImageId,InstanceType,SubnetId,Placement.AvailabilityZone,VpcId,RootDeviceName]' --output text)"
RUN_SGS=$(aws_ ec2 describe-instances --instance-ids "$RUN_ID" --query 'Reservations[0].Instances[0].SecurityGroups[].GroupId' --output text)
RUN_VOL=$(aws_ ec2 describe-instances --instance-ids "$RUN_ID" \
    --query "Reservations[0].Instances[0].BlockDeviceMappings[?DeviceName=='$RUN_ROOTDEV'].Ebs.VolumeId | [0]" --output text)
read -r VSIZE VTYPE VIOPS VTPUT <<<"$(aws_ ec2 describe-volumes --volume-ids "$RUN_VOL" \
    --query 'Volumes[0].[Size,VolumeType,Iops,Throughput]' --output text)"
say "run host $RUN_ID: $TYPE in $AZ ($SUBNET), AMI $AMI, root $VSIZE GB $VTYPE iops $VIOPS throughput $VTPUT, groups $RUN_SGS"

# The same AMI if it is still registered, else Canonical's current Ubuntu 24.04 amd64.
if [ "$(aws_ ec2 describe-images --image-ids "$AMI" --query 'Images[0].State' --output text 2>/dev/null)" != available ]; then
    AMI=$(aws_ ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
        --query Parameter.Value --output text)
    say "run host's AMI is gone; using Canonical's current Ubuntu 24.04: $AMI"
fi
ROOTDEV=$(aws_ ec2 describe-images --image-ids "$AMI" --query 'Images[0].RootDeviceName' --output text)
say "AMI $AMI: $(aws_ ec2 describe-images --image-ids "$AMI" --query 'Images[0].Name' --output text)"

# --- Key pair -------------------------------------------------------------------------------------
[ -f "$KEY" ] || ssh-keygen -q -t ed25519 -N '' -C "$NAME $(hostname -s)" -f "$KEY"
chmod 600 "$KEY"
if ! aws_ ec2 describe-key-pairs --key-names "$NAME" >/dev/null 2>&1; then
    aws_ ec2 import-key-pair --key-name "$NAME" --public-key-material "fileb://$KEY.pub" \
        --tag-specifications "ResourceType=key-pair,Tags=[{Key=Name,Value=$NAME}]" >/dev/null
    say "imported key pair $NAME"
fi

# --- Security group: the run host's ingress (SSH and RDP from the operator's address) ----------
SG=$(aws_ ec2 describe-security-groups --filters "Name=vpc-id,Values=$VPC" "Name=group-name,Values=$NAME-sg" \
    --query 'SecurityGroups[0].GroupId' --output text)
if [ "$SG" = None ] || [ -z "$SG" ]; then
    SG=$(aws_ ec2 create-security-group --group-name "$NAME-sg" --vpc-id "$VPC" \
        --description "$NAME: ingress copied from $RUN_NAME" \
        --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=$NAME-sg}]" --query GroupId --output text)
    for g in $RUN_SGS; do
        P=$(aws_ ec2 describe-security-groups --group-ids "$g" --query 'SecurityGroups[0].IpPermissions' --output json)
        [ "$(printf '%s' "$P" | tr -d ' \n')" = '[]' ] || aws_ ec2 authorize-security-group-ingress --group-id "$SG" --ip-permissions "$P" >/dev/null
    done
    say "created $SG with the ingress of $RUN_SGS"
fi
aws_ ec2 describe-security-groups --group-ids "$SG" \
    --query 'SecurityGroups[0].IpPermissions[].[IpProtocol,FromPort,ToPort,length(IpRanges),length(Ipv6Ranges)]' --output text |
    awk '{printf "provision: ingress %s %s-%s from %d IPv4 and %d IPv6 ranges\n", $1, $2, $3, $4, $5}'

# --- Instance ---------------------------------------------------------------------------------------
UD=$(mktemp)
{
    echo '#cloud-config'
    echo "hostname: $NAME"
    if [ $# -gt 0 ]; then
        echo 'ssh_authorized_keys:'
        for k in "$@"; do
            [ -f "$k" ] && k=$(cat "$k")
            case $k in ssh-*) echo "  - $k" ;; *) die "not a public key: $k" ;; esac
        done
    fi
} >"$UD"
EBS="\"VolumeSize\":$VSIZE,\"VolumeType\":\"$VTYPE\",\"DeleteOnTermination\":true"
[ "$VTYPE" = gp3 ] && EBS="$EBS,\"Iops\":$VIOPS,\"Throughput\":$VTPUT"
ID=$(aws_ ec2 run-instances --image-id "$AMI" --instance-type "$TYPE" --subnet-id "$SUBNET" \
    --security-group-ids "$SG" --key-name "$NAME" --user-data "file://$UD" \
    --block-device-mappings "[{\"DeviceName\":\"$ROOTDEV\",\"Ebs\":{$EBS}}]" \
    --metadata-options HttpTokens=required,HttpEndpoint=enabled \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME},{Key=purpose,Value=rs-147-rehearsals}]" \
    "ResourceType=volume,Tags=[{Key=Name,Value=$NAME}]" \
    --query 'Instances[0].InstanceId' --output text)
rm -f "$UD"
say "launched $ID"
aws_ ec2 wait instance-running --instance-ids "$ID"

# --- Elastic IP, so the address survives a stop ---------------------------------------------------
ALLOC=$(aws_ ec2 describe-addresses --filters "Name=tag:Name,Values=$NAME" --query 'Addresses[0].AllocationId' --output text)
if [ "$ALLOC" = None ] || [ -z "$ALLOC" ]; then
    ALLOC=$(aws_ ec2 allocate-address --domain vpc \
        --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME}]" --query AllocationId --output text)
fi
aws_ ec2 associate-address --allocation-id "$ALLOC" --instance-id "$ID" --allow-reassociation >/dev/null
EIP=$(aws_ ec2 describe-addresses --allocation-ids "$ALLOC" --query 'Addresses[0].PublicIp' --output text)

# --- known_hosts, pinned from the console (a new instance has new host keys, even at an old address)
KEYS=
for _ in $(seq 60); do
    KEYS=$(aws_ ec2 get-console-output --instance-id "$ID" --latest --query Output --output text 2>/dev/null | tr -d '\r' |
        sed -n '/-----BEGIN SSH HOST KEY KEYS-----/,/-----END SSH HOST KEY KEYS-----/p' | grep -E '^(ssh-|ecdsa-)' || true)
    [ -n "$KEYS" ] && break
    sleep 10
done
[ -n "$KEYS" ] || die "no host keys on $ID's console after 10 min; do not fall back to trust-on-first-use"
printf '%s\n' "$KEYS" | awk -v ip="$EIP" '{print ip, $1, $2}' >"$KNOWN.tmp" && mv "$KNOWN.tmp" "$KNOWN"
chmod 600 "$KNOWN"
say "pinned $(wc -l <"$KNOWN" | tr -d ' ') host keys for $EIP in $KNOWN"
SSH=(ssh -o BatchMode=yes -o IdentitiesOnly=yes -i "$KEY" -o UserKnownHostsFile="$KNOWN" -o StrictHostKeyChecking=yes -o CheckHostIP=no "ubuntu@$EIP")
for _ in $(seq 30); do "${SSH[@]}" true 2>/dev/null && break; sleep 5; done
"${SSH[@]}" 'cloud-init status --wait >/dev/null; echo "provision: ssh ok: $(hostname), $(. /etc/os-release; echo $PRETTY_NAME), $(nproc) vCPU"'

# --- RDP password for ubuntu ---------------------------------------------------------------------
[ -s "$RDP_PW" ] || openssl rand -base64 48 | LC_ALL=C tr -dc 'A-Za-z0-9' | cut -c1-24 >"$RDP_PW"
chmod 600 "$RDP_PW"
printf 'ubuntu:%s\n' "$(cat "$RDP_PW")" | "${SSH[@]}" 'sudo chpasswd && echo "provision: ubuntu password set (the Mac keeps it in ~/.rs-fleet/rehearsal-rdp-password)"'

say "done: $TYPE in $AZ"
echo "INSTANCE_ID=$ID PUBLIC_IP=$EIP"
