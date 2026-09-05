import { expect, it } from 'vitest';
import { packetPathLabel } from './packetPath';
import { projectPacketToArea } from './trafficArea';
import { TraceStore } from './traceStore';
import type { PacketView } from './types';

it('keeps explicit gaps and independent runs in history, live animation and replay', () => {
 const node=(id:string)=>({id,label:id,lat:44,lng:-77});
 const a=node('Alpha'),b=node('Bravo'),c=node('Charlie'),d=node('Delta');
 const packet:PacketView={id:'p-test',seq:1,at:Date.now(),payloadType:'Text',mode:'route',partial:true,
  segments:[{routeId:'ab',from:a,to:b},{routeId:'cd',from:c,to:d}],
  path:[{label:a.label,node:a},{label:b.label,node:b},{label:'Unknown hop'},{label:c.label,node:c},{label:d.label,node:d}]};
 expect(packetPathLabel(packet)).toBe('Alpha → Bravo … Unknown hop … Charlie → Delta');
 const result=projectPacketToArea(packet,null);
 expect(result?.runs).toHaveLength(2);
 expect(result?.runs.every(run => run.path === undefined)).toBe(true);
 const loop = {...packet, segments:[packet.segments[0]!,{routeId:'bd',from:b,to:d,breakBefore:true}]};
 expect(projectPacketToArea(loop,null)?.runs).toHaveLength(2);
 expect(result?.runs.map(run=>run.mode==='route' ? run.segments.length : 0)).toEqual([1,1]);
 const store=new TraceStore();store.merge([JSON.parse(JSON.stringify(packet))]);
 expect(store.all()[0]?.packet.path).toEqual(packet.path);
 expect(packetPathLabel({id:'p-old',seq:2,at:Date.now(),payloadType:'Text',mode:'observer',observer:d})).toContain('Heard by Delta');
});
