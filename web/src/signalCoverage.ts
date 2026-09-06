import type { Map as MapLibreMap, GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl';
import type { NodeV2, SignalCoverageV2, SignalSummaryV2 } from './types';
import { relativeTime } from './nodeInspector';

const source = 'signal-coverage';
export function signalColour(value: number, metric: 'rssi' | 'snr'): string {
  const stops: [number, number, number] = metric === 'rssi' ? [-120, -105, -90] : [-10, 0, 10];
  return value < stops[0] ? '#ee91ae' : value < stops[1] ? '#e9b66e' : value < stops[2] ? '#70c5ed' : '#59dfba';
}

export class SignalCoverage {
  private root = document.createElement('section');
  private direction = document.createElement('select');
  private window = document.createElement('select');
  private metric = document.createElement('select');
  private status = document.createElement('p');
  private legend = document.createElement('p');
  private detail = document.createElement('div');
  private prediction = document.createElement('section');
  private predictionStatus = document.createElement('p');
  private predictionInputs: Record<string, HTMLInputElement> = {};
  private list = document.createElement('select');
  private title = document.createElement('strong');
  private node?: NodeV2;
  private rows: SignalSummaryV2[] = [];
  private request?: AbortController;
  private timer?: number;
  constructor(private map: MapLibreMap, parent: HTMLElement) {
    this.root.className = 'signal-coverage-panel'; this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Measured signal coverage');
    const header = document.createElement('header');
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Close signal coverage'); close.onclick = () => this.close();
    header.append(this.title, close);
    const controls = document.createElement('div'); controls.className = 'signal-coverage-controls';
    const select = (element: HTMLSelectElement, label: string, choices: string[][]) => {
      const wrap = document.createElement('label'); wrap.append(label);
      for (const [value, text] of choices) element.add(new Option(text, value));
      wrap.append(element); controls.append(wrap);
    };
    select(this.direction, 'Direction', [['outgoing','Heard this repeater'],['incoming','Heard by this repeater']]);
    select(this.window, 'History', [['1h','1 hour'],['24h','24 hours'],['7d','7 days']]); this.window.value = '24h';
    select(this.metric, 'Signal', [['rssi','RSSI · dBm'],['snr','SNR · dB']]);
    this.direction.onchange = this.window.onchange = () => { void this.load(); };
    this.metric.onchange = () => this.draw();
    this.list.setAttribute('aria-label','Inspect measurement location'); this.list.onchange = () => this.inspect(Number(this.list.value));
    this.prediction.className = 'signal-prediction-inputs';
    const predictionHeading = document.createElement('strong'); predictionHeading.textContent = 'Prediction inputs · this repeater';
    const predictionNote = document.createElement('small'); predictionNote.textContent = 'Values vary by hardware. Saved only in this browser; measured data above is unchanged.';
    const predictionForm = document.createElement('form'); predictionForm.className = 'signal-prediction-form';
    const fields: [string,string,string,string][] = [
      ['txPower','Transmit power','dBm','1'], ['antennaHeight','Antenna height','m','0'],
      ['antennaGain','Antenna gain','dBi','0'], ['cableLoss','Cable loss','dB','0'],
      ['receiverHeight','Receiver height','m','0'], ['receiverGain','Receiver gain','dBi','0'],
    ];
    for (const [name,label,unit,min] of fields) {
      const wrap = document.createElement('label'); wrap.textContent = label + ' (' + unit + ')';
      const input = document.createElement('input'); input.name = name; input.type = 'number'; input.step = 'any'; input.min = min; input.inputMode = 'decimal'; input.required = true; input.autocomplete = 'off';
      this.predictionInputs[name] = input; wrap.append(input); predictionForm.append(wrap);
    }
    const radio = document.createElement('small'); radio.textContent = 'MeshCore USA/Canada preset: 910.525 MHz · BW62.5 · SF7 · CR5';
    const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Save inputs';
    this.predictionStatus.className = 'signal-prediction-status'; this.predictionStatus.setAttribute('role','status');
    predictionForm.append(radio, save); predictionForm.onsubmit = (event) => { event.preventDefault(); this.savePredictionInputs(); };
    this.prediction.append(predictionHeading, predictionNote, predictionForm, this.predictionStatus);
    this.status.setAttribute('role','status');
    this.root.append(header, controls, this.legend, this.status, this.list, this.detail, this.prediction);
    parent.append(this.root);
    this.map.on('style.load', this.draw);
    this.map.on('click', source, this.click);
  }
  show(node: NodeV2): void {
    this.close(); this.node = node; this.root.hidden = false;
    this.root.parentElement?.classList.add('coverage-open');
    this.title.textContent = `Measured signal · ${node.label}`;
    this.loadPredictionInputs();
    void this.load();
    this.timer = window.setInterval(() => { void this.load(); }, 30_000);
    this.direction.focus({ preventScroll: true });
    this.root.scrollTop = 0;
  }
  close(): void {
    this.request?.abort(); window.clearInterval(this.timer);
    this.node = undefined; this.rows = []; this.root.hidden = true;
    this.root.parentElement?.classList.remove('coverage-open'); this.draw();
  }
  destroy(): void { this.close(); this.map.off('style.load', this.draw); this.map.off('click', source, this.click); this.root.remove(); }
  private inputKey(): string { return 'cartolite-signal-inputs:' + (this.node?.id ?? ''); }
  private loadPredictionInputs(): void {
    for (const input of Object.values(this.predictionInputs)) input.value = '';
    this.predictionStatus.textContent = 'Prediction is waiting for these hardware values.';
    try {
      const raw = localStorage.getItem(this.inputKey()); if (!raw) return;
      const values = JSON.parse(raw) as Record<string, unknown>;
      for (const [name,input] of Object.entries(this.predictionInputs)) {
        const value = values[name]; if (typeof value === 'number' && Number.isFinite(value)) input.value = String(value);
      }
      this.predictionStatus.textContent = 'Saved locally. Prediction remains disabled until the model is validated.';
    } catch { /* storage is optional */ }
  }
  private savePredictionInputs(): void {
    const values: Record<string, number> = {};
    for (const [name,input] of Object.entries(this.predictionInputs)) {
      const value = Number(input.value); if (!Number.isFinite(value) || value < Number(input.min)) { this.predictionStatus.textContent = 'Enter valid non-negative hardware values.'; input.focus(); return; }
      values[name] = value;
    }
    try { localStorage.setItem(this.inputKey(), JSON.stringify(values)); this.predictionStatus.textContent = 'Saved locally. Prediction remains disabled until the model is validated.'; }
    catch { this.predictionStatus.textContent = 'Could not save locally; keep these values available for the model setup.'; }
  }
  private async load(): Promise<void> {
    if (!this.node) return;
    this.request?.abort(); const request = new AbortController(); this.request = request;
    this.rows = []; this.draw();
    this.status.textContent = 'Loading retained measurements…';
    try {
      const query = new URLSearchParams({ node: this.node.id, direction: this.direction.value, window: this.window.value });
      const response = await fetch(`/api/signal-coverage?${query}`, { signal: request.signal });
      if (!response.ok) throw new Error('Measurements unavailable');
      const data: SignalCoverageV2 = await response.json();
      if (request.signal.aborted) return;
      this.rows = data.summaries;
      const excluded = Object.entries(data.excluded).map(([reason,count]) => `${count} ${reason.replaceAll('-', ' ')}`).join('; ');
      this.status.textContent = `${this.rows.length ? `${this.rows.length} measurement groups` : 'Not enough measurements'} · saved coverage is partial · 5-minute buckets · approximate medians.${excluded ? ` Excluded from retained raw history: ${excluded}.` : ''}`;
      this.draw();
    } catch {
      if (request.signal.aborted) return;
      this.rows = []; this.draw(); this.status.textContent = 'Measurements unavailable. Retrying in 30 seconds.';
    }
  }
  private click = (event: MapLayerMouseEvent): void => { const index = Number(event.features?.[0]?.properties?.index); if (Number.isInteger(index)) this.inspect(index); };
  private draw = (): void => {
    const metric = this.metric.value as 'rssi' | 'snr';
    const thresholds = metric === 'rssi' ? ['< −120','−120 to −105','−105 to −90','≥ −90'] : ['< −10','−10 to 0','0 to 10','≥ 10'];
    this.legend.replaceChildren();
    thresholds.forEach((label,i) => { const item = document.createElement('span'); item.textContent = `${label} ${metric === 'rssi' ? 'dBm' : 'dB'}`; item.style.borderColor = ['#ee91ae','#e9b66e','#70c5ed','#59dfba'][i]!; this.legend.append(item); });
    const note = document.createElement('small'); note.textContent = 'Colour = approximate median signal, not delivery rate. White ring = fewer than 3 samples. Faded = stale or unknown location age. Unmeasured areas stay unknown.';
    this.legend.append(note);
    this.list.replaceChildren(new Option('Inspect a measurement…','')); this.detail.replaceChildren();
    const features = this.rows.flatMap((row,index) => {
      const reading = row[metric]; if (!reading) return [];
      const peer = this.direction.value === 'outgoing' ? row.receiver : row.transmitter;
      this.list.add(new Option(`${peer.label} · ${reading.median} ${metric === 'rssi' ? 'dBm' : 'dB'}`,String(index)));
      return [{ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates:[peer.lng,peer.lat] }, properties: {index, colour:signalColour(reading.median,metric), sparse:reading.count<3, uncertain:row.locationQuality!=='last-known'} }];
    });
    this.list.hidden = features.length === 0;
    if (this.rows.length && !features.length) this.detail.textContent = 'Not enough measurements for this signal metric.';
    if (!this.map.isStyleLoaded()) return;
    if (!this.map.getSource(source)) {
      this.map.addSource(source,{type:'geojson',data:{type:'FeatureCollection',features:[]}});
      this.map.addLayer({ id:source,type:'circle',source,paint:{ 'circle-radius':12,'circle-color':['get','colour'],'circle-opacity':['case',['get','uncertain'],0.45,0.9],'circle-stroke-width':['case',['get','sparse'],3,1],'circle-stroke-color':['case',['get','sparse'],'#ffffff','#09232a'] } });
    }
    (this.map.getSource(source) as GeoJSONSource).setData({type:'FeatureCollection',features});
  };
  private inspect(index: number): void {
    const row = this.rows[index]; if (!row) return;
    this.list.value = String(index);
    this.detail.replaceChildren();
    const heading = document.createElement('strong'); heading.textContent = `${row.transmitter.label} → ${row.receiver.label}`;
    const description = document.createElement('p');
    description.textContent = `${row.samples} retained receptions · last heard ${relativeTime(row.lastAt)} · ${row.locationQuality.replaceAll('-', ' ')} location. First: ${new Date(row.firstAt).toLocaleString()}; latest: ${new Date(row.lastAt).toLocaleString()}.`;
    this.detail.append(heading,description);
    for (const metric of ['rssi','snr'] as const) {
      const value = row[metric]; if (!value) continue;
      const line = document.createElement('p'); line.textContent = `${metric.toUpperCase()}: approx. median ${value.median}, range ${value.min} to ${value.max} ${metric === 'rssi' ? 'dBm' : 'dB'} · ${value.count} readings`; this.detail.append(line);
    }
  }
}
