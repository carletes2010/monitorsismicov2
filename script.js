/* Helpers */
const $=(id)=>document.getElementById(id);
const showErr=(m)=>{ $('errPanel').style.display='block'; $('errText').textContent=String(m||'Error'); };
window.addEventListener('error',(e)=>showErr(e?.message||e));

/* Mapbox */
mapboxgl.accessToken='pk.eyJ1IjoiYWx6b2FsZXJ0YXNpc21pY2EiLCJhIjoiY2wyNHM2c25vMjNoejNpcWRrb3Y4MzV6ciJ9.D2pXLxF0emuIHvrW-n181Q';

/* DOM */
const tit=$('tit'), dist=$('dist'), eta=$('eta'), foco=$('foco'), flecha=$('flecha');
const sevBar=$('sevBar');
const logWrap=$('log'), logList=$('logList');

const popupOverlay=$('popupOverlay'), popupSub=$('popupSub'), popupS=$('popupS'), popupP=$('popupP'), popupDate=$('popupDate');
const eqwAudio=$('eqwAudio'), advAudio=$('advAudio');

/* Config */
const toggleCentrales=$('toggleCentrales');
const toggleLog=$('toggleLog');
const togglePopup=$('togglePopup');
const toggleSymb=$('toggleSymb');
const strongSoundSelect=$('strongSoundSelect');
const strongSoundFile=$('strongSoundFile');

/* Estado */
const CDMX=[-99.1332, 19.4326];
const FIXED_ZOOM=5.5;
const EVENT_MS=120000;
const POPUP_DELAY_MS=15000;

/* Ondas (P amarilla, S roja) */
const WAVE_P='#ffc400';
const WAVE_S='#ff3b4a';

let map, mapReady=false;
let lastEvt=null;
let audioPrimed=false;

let clearTimer=null;
let popupTimer=null;
let rafWaves=null;
let rafPopup=null;

let popupToken=0;
let popupDismissedToken=0;

/* Centrales */
const CENTRALES=[
  {id:'CDMX',lng:-99.1332,lat:19.4326},
  {id:'OAX', lng:-96.7266,lat:17.0732},
  {id:'ACA', lng:-99.9120,lat:16.8532},
  {id:'CHP', lng:-99.5014,lat:17.5514},
  {id:'MOR', lng:-101.1850,lat:19.7053},
  {id:'PUE', lng:-98.2063,lat:19.0414},
  {id:'CUA', lng:-99.2357,lat:18.9242},
  {id:'COL', lng:-103.7241,lat:19.2433},
  {id:'TOL', lng:-99.6557,lat:19.2826}
];
let trebolImages=[], trebolWraps=[];

/* Severidad */
const COLORS={leve:'#00c853', mod:'#ffc400', fue:'#ff3b4a', viol:'#7a001f', ext:'#6a00ff'};
const LABELS={leve:'Leve', mod:'Moderado', fue:'Fuerte', viol:'Violento', ext:'Extremo'};
const ORDER=['leve','mod','fue','viol','ext'];
const IDX=Object.fromEntries(ORDER.map((k,i)=>[k,i]));

/* Utils */
const km=(lat1,lon1,lat2,lon2)=>{
  const R=6371, p=0.017453292519943295;
  const a=0.5-Math.cos((lat2-lat1)*p)/2 + Math.cos(lat1*p)*Math.cos(lat2*p)*(1-Math.cos((lon2-lon1)*p))/2;
  return 12742*Math.asin(Math.sqrt(a));
};
const fmtTime=()=>new Date().toLocaleTimeString(undefined,{hour12:false});
const fmtDate=()=>{
  const d=new Date();
  const dd=String(d.getDate()).padStart(2,'0');
  const mm=['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'][d.getMonth()];
  const yy=d.getFullYear();
  const hh=String(d.getHours()).padStart(2,'0');
  const mi=String(d.getMinutes()).padStart(2,'0');
  const ss=String(d.getSeconds()).padStart(2,'0');
  return `${dd} ${mm} ${yy} ${hh}:${mi}:${ss}`;
};
function setArrowByTipo(tipo){
  const idx=(tipo in IDX)?IDX[tipo]:IDX.fue;
  const rect=sevBar.getBoundingClientRect();
  const seg=rect.width/ORDER.length;
  flecha.style.left=`${seg*(idx+0.5)}px`;
}
window.addEventListener('resize',()=>{ if(lastEvt?.tipo) setArrowByTipo(lastEvt.tipo); });

/* Geometría para ondas: radio en METROS */
function circMeters([lo,la], rMeters, n=96){
  const cos=Math.max(0.1,Math.cos(la*Math.PI/180));
  const dx=rMeters/(111320*cos);
  const dy=rMeters/110574;
  const c=[];
  for(let i=0;i<n;i++){
    const a=2*Math.PI*i/n;
    c.push([lo+dx*Math.cos(a), la+dy*Math.sin(a)]);
  }
  c.push(c[0]);
  return {type:'Feature',geometry:{type:'Polygon',coordinates:[c]}};
}

/* CÍRCULOS ESTÁTICOS (50-300km) */
const RINGS_KM=[50,100,150,200,250,300];
function addStaticRingsScaffold(){
  if(!mapReady) return;
  if(!map.getSource('rings')) map.addSource('rings',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  if(!map.getLayer('rings-line')){
    map.addLayer({
      id:'rings-line',
      type:'line',
      source:'rings',
      paint:{'line-color':'rgba(255,255,255,.55)','line-width':1,'line-opacity':1},
      layout:{'line-join':'round','line-cap':'round'}
    });
  }
}
function updateStaticRings(epicLngLat){
  if(!mapReady) return;
  const feats=RINGS_KM.map(kmVal=>{
    const rMeters=kmVal*1000;
    const poly=circMeters(epicLngLat, rMeters);
    poly.properties={km:kmVal};
    return poly;
  });
  map.getSource('rings')?.setData({type:'FeatureCollection',features:feats});
}
function clearStaticRings(){
  if(!mapReady) return;
  map.getSource('rings')?.setData({type:'FeatureCollection',features:[]});
}

/* Reverse geocode: SOLO ESTADO */
function normalizeStateName(name){
  if(!name) return null;
  let s=String(name).trim();
  s=s.replace(/^estado de\s+/i,'').replace(/^province of\s+/i,'').replace(/^state of\s+/i,'');
  if(/^mexico city$/i.test(s)||/^ciudad de mexico$/i.test(s)||/^cdmx$/i.test(s)) s='Ciudad de México';
  return s.toUpperCase();
}
async function resolveEpicenterState(lat,lng){
  try{
    const url=`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=region&language=es&limit=1&access_token=${mapboxgl.accessToken}`;
    const r=await fetch(url);
    const j=await r.json();
    const f=j?.features?.[0];
    if(!f) return null;
    return normalizeStateName(f.text_es||f.text);
  }catch(e){
    return null;
  }
}

/* Config persistente */
const LS={centrales:'cfg_show_centrales',log:'cfg_show_log',popup:'cfg_show_popup',symb:'cfg_show_symb',sound:'cfg_alert_sound'};
function loadCfg(){
  const sc=localStorage.getItem(LS.centrales);
  toggleCentrales.checked=(sc===null)?true:(sc==='1');
  const sl=localStorage.getItem(LS.log);
  toggleLog.checked=(sl===null)?true:(sl==='1');
  const sp=localStorage.getItem(LS.popup);
  togglePopup.checked=(sp===null)?false:(sp==='1');
  const ss=localStorage.getItem(LS.symb);
  toggleSymb.checked=(ss===null)?true:(ss==='1');

  const snd=localStorage.getItem(LS.sound);
  if(snd){ strongSoundSelect.value=snd; eqwAudio.src=snd; }

  applyLogVisibility();
  applyCentralesVisibility();
  applySymbVisibility();
}
function saveCfg(){
  localStorage.setItem(LS.centrales,toggleCentrales.checked?'1':'0');
  localStorage.setItem(LS.log,toggleLog.checked?'1':'0');
  localStorage.setItem(LS.popup,togglePopup.checked?'1':'0');
  localStorage.setItem(LS.symb,toggleSymb.checked?'1':'0');
  localStorage.setItem(LS.sound,strongSoundSelect.value);
}
function applyLogVisibility(){ logWrap.style.display=toggleLog.checked?'block':'none'; }
function applySymbVisibility(){
  const symb=$('symb');
  if(!symb) return;
  symb.style.display = toggleSymb.checked ? 'block' : 'none';
  symb.classList.toggle('symbPaused', !toggleSymb.checked);
}

/* Centrales visibilidad */
function applyCentralesVisibility(){
  if(!mapReady) return;
  const v=toggleCentrales.checked?'visible':'none';
  if(map.getLayer('centrales-dot')) map.setLayoutProperty('centrales-dot','visibility',v);
  if(map.getLayer('centrales-text')) map.setLayoutProperty('centrales-text','visibility',v);
  trebolWraps.forEach(w=> w.style.display = toggleCentrales.checked ? '' : 'none');
  if(!toggleCentrales.checked) toggleTrebolAnimation(false);
}

/* UI menus */
function closeMenus(){ $('simMenu').style.display='none'; $('configPanel').style.display='none'; }
document.addEventListener('click',(e)=>{ if(!$('alertWrap').contains(e.target)) closeMenus(); });

/* Audio prime */
$('activateBtn').onclick=()=>{
  $('overlay').style.display='none';
  if(!audioPrimed){
    [eqwAudio,advAudio].forEach(a=>{
      const v=a.volume; a.volume=0.0001;
      a.play().then(()=>{ a.pause(); a.currentTime=0; a.volume=v; }).catch(()=>{});
    });
    audioPrimed=true;
  }
};

/* Popup */
$('popupClose').onclick=()=>{ popupDismissedToken=popupToken; hidePopup(); };
popupOverlay.addEventListener('click',(e)=>{ if(e.target===popupOverlay){ popupDismissedToken=popupToken; hidePopup(); }});
function showPopup(){ popupOverlay.style.display='flex'; popupOverlay.setAttribute('aria-hidden','false'); }
function hidePopup(){
  popupOverlay.style.display='none';
  popupOverlay.setAttribute('aria-hidden','true');
  if(rafPopup) cancelAnimationFrame(rafPopup);
  rafPopup=null;
}

/* Map init fijo */
function initMap(){
  try{
    map=new mapboxgl.Map({
      container:'map',
      style:'mapbox://styles/mapbox/outdoors-v12',
      center:CDMX,
      zoom:FIXED_ZOOM,
      minZoom:FIXED_ZOOM,
      maxZoom:FIXED_ZOOM,
      interactive:false
    });

    map.scrollZoom.disable();map.boxZoom.disable();map.dragRotate.disable();map.dragPan.disable();
    map.keyboard.disable();map.doubleClickZoom.disable();map.touchZoomRotate.disable();map.touchPitch.disable();

    map.on('error',(e)=>showErr((e?.error?.message)||JSON.stringify(e?.error||e)));

    map.on('load', ()=>{
      mapReady=true;
      addWavesScaffold();
      addStaticRingsScaffold();
      addCentrales();
      createTrebolMarkers();
      loadCfg();
      setArrowByTipo('fue');
    });
  }catch(err){ showErr(err?.message||err); }
}

/* Ondas */
function addWavesScaffold(){
  const tiny=circMeters(CDMX,1);

  if(!map.getSource('ondaP')) map.addSource('ondaP',{type:'geojson',data:tiny});
  if(!map.getSource('ondaS')) map.addSource('ondaS',{type:'geojson',data:tiny});

  if(!map.getLayer('ondaP-fill')){
    map.addLayer({id:'ondaP-fill',type:'fill',source:'ondaP',
      paint:{'fill-color':'transparent','fill-outline-color':WAVE_P}});
  }
  if(!map.getLayer('ondaP-line')){
    map.addLayer({id:'ondaP-line',type:'line',source:'ondaP',
      paint:{'line-color':WAVE_P,'line-width':2,'line-opacity':1},
      layout:{'line-join':'round','line-cap':'round'}});
  }

  if(!map.getLayer('ondaS-fill')){
    map.addLayer({id:'ondaS-fill',type:'fill',source:'ondaS',
      paint:{'fill-color':'transparent','fill-outline-color':WAVE_S}});
  }
  if(!map.getLayer('ondaS-line')){
    map.addLayer({id:'ondaS-line',type:'line',source:'ondaS',
      paint:{'line-color':WAVE_S,'line-width':2,'line-opacity':1},
      layout:{'line-join':'round','line-cap':'round'}});
  }
}
function resetWaves(){
  const tiny=circMeters(CDMX,1);
  map.getSource('ondaP')?.setData(tiny);
  map.getSource('ondaS')?.setData(tiny);
}

/* Centrales */
function addCentrales(){
  const features=CENTRALES.map(c=>({type:'Feature',geometry:{type:'Point',coordinates:[c.lng,c.lat]},properties:{id:c.id}}));
  if(!map.getSource('centrales')) map.addSource('centrales',{type:'geojson',data:{type:'FeatureCollection',features}});

  if(!map.getLayer('centrales-dot')){
    map.addLayer({
      id:'centrales-dot',type:'circle',source:'centrales',
      paint:{'circle-radius':9,'circle-color':'#004AAD','circle-stroke-width':4,'circle-stroke-color':'#7ED957'}
    });
  }
}

/* Trébol markers */
function createTrebolMarkers(){
  if(trebolImages.length) return;
  CENTRALES.forEach(c=>{
    const wrap=document.createElement('div');
    wrap.className='trebol-marker-wrap';

    const img=document.createElement('img');
    img.className='trebol-img';
    img.src='https://carletes2010.github.io/monitorsismicov2/assets/trebol.png';
    img.alt='alert';

    wrap.appendChild(img);
    trebolWraps.push(wrap);
    trebolImages.push(img);

    new mapboxgl.Marker({element:wrap,anchor:'center'}).setLngLat([c.lng,c.lat]).addTo(map);
  });
  applyCentralesVisibility();
}
function toggleTrebolAnimation(active){
  const canShow = active && toggleCentrales.checked;
  trebolImages.forEach(img=>{
    if(canShow) img.classList.add('active');
    else img.classList.remove('active');
  });
}

/* Bitácora */
function pushLog(tipo,color,text){
  if(!toggleLog.checked) return;
  const li=document.createElement('div');
  li.className='entry';
  li.innerHTML=`<div class="dot" style="background:${color}"></div>
  <div class="meta"><b>${String(tipo).toUpperCase()}</b> · ${fmtTime()}<br/>${text}</div>`;
  logList.prepend(li);
  if(logList.children.length>200) logList.removeChild(logList.lastElementChild);
}

/* Animación ondas + countdown HUD */
function startWavesAndCountdown(epicLngLat, etaS0, etaP0){
  if(rafWaves) cancelAnimationFrame(rafWaves);
  const t0=performance.now();

  const step=(now)=>{
    const s=(now-t0)/1000;
    const rP=Math.max(1, 8000*s);
    const rS=Math.max(1, 5000*s);

    map.getSource('ondaP')?.setData(circMeters(epicLngLat, rP));
    map.getSource('ondaS')?.setData(circMeters(epicLngLat, rS));

    const remainS=Math.max(0, Math.round(etaS0 - s));
    eta.textContent = `ETA: ${remainS} s`;

    if(lastEvt && s < (EVENT_MS/1000)) rafWaves=requestAnimationFrame(step);
  };
  rafWaves=requestAnimationFrame(step);
}

/* Evento */
async function drawEvent(evt){
  if(!mapReady) return;

  clearEvent();
  lastEvt=evt;

  const {latitud, longitud}=evt;
  let tipo=evt.tipo||'fue';
  if(!(tipo in COLORS)) tipo='fue';

  const color=COLORS[tipo];
  foco.style.background=color;
  tit.textContent=`Sismo ${LABELS[tipo]}`;
  setArrowByTipo(tipo);

  const d=km(latitud,longitud,CDMX[1],CDMX[0]);
  dist.textContent=`Distancia: ${d.toFixed(0)} km`;

  const etaS0=d/5.0;
  const etaP0=d/8.0;
  eta.textContent=`ETA: ${Math.max(0,Math.round(etaS0))} s`;

  const state=await resolveEpicenterState(latitud,longitud);
  pushLog(tipo,color, state ? `Sismo en ${state}` : `Lat:${latitud} Lon:${longitud}`);

  const epic=[longitud,latitud];
  addWavesScaffold();
  addStaticRingsScaffold();
  updateStaticRings(epic);
  startWavesAndCountdown(epic, etaS0, etaP0);

  const isAlert=['fue','viol','ext'].includes(tipo);

  if(isAlert){
    toggleTrebolAnimation(true);
    if(audioPrimed){ eqwAudio.currentTime=0; eqwAudio.play().catch(()=>{}); }
  }else{
    toggleTrebolAnimation(false);
    if(audioPrimed){ advAudio.currentTime=0; advAudio.play().catch(()=>{}); }
  }

  popupToken=Date.now();
  popupDismissedToken=0;

  if(isAlert && togglePopup.checked){
    popupTimer=setTimeout(()=>{
      if(!lastEvt) return;
      if(popupDismissedToken===popupToken) return;

      popupSub.textContent=`SISMO EN ${state || '--'}`;
      popupDate.textContent=fmtDate();

      const delaySec=POPUP_DELAY_MS/1000;
      popupS.textContent=String(Math.max(0, Math.round(etaS0 - delaySec)));
      popupP.textContent=String(Math.max(0, Math.round(etaP0 - delaySec)));

      showPopup();

      const popupStart=performance.now();
      const tick=(now)=>{
        if(popupDismissedToken===popupToken) return;
        const elapsed=(now-popupStart)/1000 + delaySec;
        popupS.textContent=String(Math.max(0, Math.round(etaS0 - elapsed)));
        popupP.textContent=String(Math.max(0, Math.round(etaP0 - elapsed)));
        popupDate.textContent=fmtDate();
        if(lastEvt && elapsed < (EVENT_MS/1000)) rafPopup=requestAnimationFrame(tick);
      };
      rafPopup=requestAnimationFrame(tick);

    }, POPUP_DELAY_MS);
  }

  clearTimer=setTimeout(clearEvent, EVENT_MS);
}

function clearEvent(){
  if(clearTimer){ clearTimeout(clearTimer); clearTimer=null; }
  if(popupTimer){ clearTimeout(popupTimer); popupTimer=null; }
  if(rafWaves){ cancelAnimationFrame(rafWaves); rafWaves=null; }
  if(rafPopup){ cancelAnimationFrame(rafPopup); rafPopup=null; }

  if(mapReady) resetWaves();
  if(mapReady) clearStaticRings();

  toggleTrebolAnimation(false);
  foco.style.background='#999';
  tit.textContent='Monitoreando';
  dist.textContent='Distancia: -- km';
  eta.textContent='ETA: -- seg';

  hidePopup();

  eqwAudio.pause(); eqwAudio.currentTime=0;
  advAudio.pause(); advAudio.currentTime=0;

  lastEvt=null;
}

/* UI */
$('alertBtn').onclick=()=>{
  const m=$('simMenu');
  const open=(m.style.display==='flex');
  closeMenus();
  m.style.display=open?'none':'flex';
};
$('cfgBtn').onclick=()=>{
  const p=$('configPanel');
  const open=(p.style.display==='flex');
  closeMenus();
  p.style.display=open?'none':'flex';
};
$('cfgClose').onclick=()=>{ $('configPanel').style.display='none'; };

toggleCentrales.addEventListener('change',()=>{ saveCfg(); applyCentralesVisibility(); });
toggleLog.addEventListener('change',()=>{ saveCfg(); applyLogVisibility(); });
togglePopup.addEventListener('change',()=>{ saveCfg(); if(!togglePopup.checked) hidePopup(); });
toggleSymb.addEventListener('change',()=>{ saveCfg(); applySymbVisibility(); });

strongSoundSelect.addEventListener('change',()=>{
  eqwAudio.src=strongSoundSelect.value;
  saveCfg();
});
strongSoundFile.addEventListener('change',()=>{
  const f=strongSoundFile.files && strongSoundFile.files[0];
  if(!f) return;
  eqwAudio.src=URL.createObjectURL(f);
});

/* Simulacros */
$('simLEV').onclick=()=>drawEvent({latitud:16.8532,longitud:-99.9120,tipo:'leve'});
$('simMOD').onclick=()=>drawEvent({latitud:16.8532,longitud:-99.9120,tipo:'mod'});
$('simFUE').onclick=()=>drawEvent({latitud:16.8532,longitud:-99.9120,tipo:'fue'});
$('simVIO').onclick=()=>drawEvent({latitud:16.8532,longitud:-99.9120,tipo:'viol'});
$('simEXT').onclick=()=>drawEvent({latitud:16.8532,longitud:-99.9120,tipo:'ext'});
$('simCLR').onclick=()=>clearEvent();

/* Pusher */
const pusher=new Pusher('0f74c31648d3adb34e1b',{cluster:'us2',forceTLS:true});
pusher.subscribe('alertas-sasno').bind('mapa_pop', d=>{
  if(d && typeof d.latitud==='number' && typeof d.longitud==='number'){
    drawEvent(d);
  }else{
    clearEvent();
  }
});

/* Inicio */
initMap();
