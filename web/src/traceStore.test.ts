import { describe, it, expect, vi } from 'vitest';
import { TraceStore, TRACE_MAX_AGE } from './traceStore';
import type { PacketView } from './types';

describe('saved packet observations', () => {
  it('merges history with live packets without duplicates or replaying stale radio data', () => {
    const now = Date.now();
    const p: PacketView = { id:'p-test', seq:1, at:now, mode:'observer', payloadType:'Text', rssi:-82, snr:6,
      observer:{id:'n-test',label:'North',lat:44,lng:-77} };
    const store = new TraceStore();
    store.add(p);
    store.merge([p, {...p,id:'p-old',at:now - TRACE_MAX_AGE - 1}, {...p,id:'p-second',seq:2}]);
    expect(store.all().map(row => row.packet.id)).toEqual(['p-test','p-second']);
    const returned = new TraceStore(); returned.merge(JSON.parse(JSON.stringify(store.all().map(row => row.packet))));
    expect(returned.all()[0]?.packet.rssi).toBe(-82);
    returned.merge([null, {...p,id:'bad',rssi:999}, {...p,id:'bad2',observer:null}]);
    expect(returned.all()).toHaveLength(2);
    vi.spyOn(Date,'now').mockReturnValue(now + TRACE_MAX_AGE + 1);
    returned.merge([]); expect(returned.all()).toHaveLength(0); vi.restoreAllMocks();
  });
});
