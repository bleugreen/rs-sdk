import { expect, test } from 'bun:test';
import { botTabs, type CdpTarget } from './tab';

test('botTabs finds this bot\'s client pages and nothing else', () => {
    const targets: CdpTarget[] = [
        { id: 'a', type: 'page', url: 'http://127.0.0.1:8889/bot?server=rs-sdk-demo.fly.dev&gateway=ws://127.0.0.1:7780&bot=runner1&password=x' },
        { id: 'b', type: 'page', url: 'http://127.0.0.1:8889/bot?bot=runner10&password=x' },
        { id: 'c', type: 'service_worker', url: 'http://127.0.0.1:8889/bot?bot=runner1' },
        { id: 'd', type: 'page', url: 'chrome://newtab/' },
        { id: 'e', type: 'page', url: 'http://127.0.0.1:8889/bot?bot=runner1&password=x' },
    ];
    expect(botTabs(targets, 'runner1').map(t => t.id)).toEqual(['a', 'e']);
    expect(botTabs(targets, 'nobody')).toEqual([]);
});
