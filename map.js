// Import Mapbox and D3 as ES modules
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Mapbox access token
mapboxgl.accessToken = 'pk.eyJ1Ijoia3lsZWNob2kxMDEiLCJhIjoiY21hcWRuZXJ3MDhvMTJpb2Fvb2lnbGRncyJ9.fIyyCQPuXUakQdn1mvE4lQ';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18
});

// Shared style for bike lanes
const sharedPaint = { 'line-color':'#32D400', 'line-width':4, 'line-opacity':0.6 };

// Helpers
function getCoords(station) {
  const { x, y } = map.project([+station.lon, +station.lat]);
  return { cx: x, cy: y };
}
function formatTime(minutes) {
  const d = new Date(0,0,0,0,minutes);
  return d.toLocaleString('en-US',{timeStyle:'short'});
}
function minutesSinceMidnight(date) {
  return date.getHours()*60 + date.getMinutes();
}

// Buckets for performance
const departuresByMinute = Array.from({length:1440},()=>[]);
const arrivalsByMinute   = Array.from({length:1440},()=>[]);
function filterByMinute(buckets, minute) {
  if (minute<0) return buckets.flat();
  const minM = (minute - 60 + 1440)%1440;
  const maxM = (minute + 60)%1440;
  if (minM>maxM) return buckets.slice(minM).concat(buckets.slice(0,maxM)).flat();
  return buckets.slice(minM, maxM).flat();
}
function computeStationTraffic(stations, timeFilter=-1) {
  const deps = d3.rollup(filterByMinute(departuresByMinute,timeFilter),v=>v.length,d=>d.start_station_id);
  const arrs = d3.rollup(filterByMinute(arrivalsByMinute,timeFilter),v=>v.length,d=>d.end_station_id);
  return stations.map(s=>{
    const id=s.short_name;
    const dep=deps.get(id)||0;
    const arr=arrs.get(id)||0;
    return {...s,departures:dep,arrivals:arr,totalTraffic:dep+arr};
  });
}

map.on('load',async()=>{
  // Bike lanes
  map.addSource('boston_route',{type:'geojson',data:'data/Existing_Bike_Network_2022.geojson'});
  map.addLayer({id:'bike-lanes',type:'line',source:'boston_route',paint:sharedPaint});
  map.addSource('cambridge_route',{type:'geojson',data:'data/RECREATION_BikeFacilities.geojson'});
  map.addLayer({id:'cambridge-lanes',type:'line',source:'cambridge_route',paint:sharedPaint});

  // Load stations
  const {data} = await d3.json('data/bluebikes-stations.json');
  const rawStations = data.stations;

  // Load trips & bucket
  await d3.csv('data/bluebikes-traffic-2024-03.csv',trip=>{
    trip.started_at=new Date(trip.started_at);
    trip.ended_at=new Date(trip.ended_at);
    departuresByMinute[minutesSinceMidnight(trip.started_at)].push(trip);
    arrivalsByMinute[minutesSinceMidnight(trip.ended_at)].push(trip);
    return trip;
  });

  // Initial traffic
  let stations = computeStationTraffic(rawStations);

  // Radius scale
  const radiusScale = d3.scaleSqrt().domain([0,d3.max(stations,d=>d.totalTraffic)]).range([0,25]);

  // SVG overlay
  const svg = d3.select(map.getCanvasContainer()).append('svg')
    .style('position','absolute').style('top',0).style('left',0)
    .style('width','100%').style('height','100%').style('pointer-events','none');

  // Draw circles with departure ratio style
  let circles = svg.selectAll('circle')
    .data(stations,d=>d.short_name)
    .enter().append('circle')
    .attr('r',d=>radiusScale(d.totalTraffic))
    .style('pointer-events','auto')
    .style('--departure-ratio', d=> d.departures/d.totalTraffic)
    .each(function(d) {
        d3.select(this).append('title')
        .text(
            `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
          );
      });

  function updatePositions(){
    circles.attr('cx',d=>getCoords(d).cx).attr('cy',d=>getCoords(d).cy);
  }
  updatePositions();
  ['move','zoom','resize','moveend'].forEach(e=>map.on(e,updatePositions));

  // Slider UI
  const timeSlider=document.getElementById('timeRange');
  const timeDisplay=document.getElementById('selectedTime');
  const anyHint=document.getElementById('anyTimeHint');

  function updateScatterPlot(timeFilter){
    radiusScale.range(timeFilter<0?[0,25]:[3,50]);
    const filtered=computeStationTraffic(rawStations,timeFilter);
    circles=circles.data(filtered,d=>d.short_name).join(
      enter=>enter.append('circle')
        .style('pointer-events','auto'),
      update=>update,
      exit=>exit.remove()
    )
    .attr('r',d=>radiusScale(d.totalTraffic))
    .style('--departure-ratio',d=>d.departures/d.totalTraffic);
    updatePositions();
  }

  function updateTimeDisplay(){
    const v=+timeSlider.value;
    if(v<0){timeDisplay.textContent='(any time)';anyHint.style.display='block';}
    else{timeDisplay.textContent=formatTime(v);anyHint.style.display='none';}
    updateScatterPlot(v);
  }
  timeSlider.addEventListener('input',updateTimeDisplay);
  updateTimeDisplay();

  // Play/Pause button
  const playBtn=document.getElementById('playPause');
  if(playBtn){let playing=false,dir=1,ticker;
    playBtn.addEventListener('click',()=>{
      playing=!playing;
      playBtn.textContent=playing?'⏸️ Pause':'▶️ Play';
      if(playing){
        ticker=setInterval(()=>{
          let v=+timeSlider.value+dir*5;
          const min=+timeSlider.min,max=+timeSlider.max;
          if(v>max){v=max;dir=-1;}else if(v<min){v=min;dir=1;}
          timeSlider.value=v;updateTimeDisplay();
        },200);
      } else clearInterval(ticker);
    });
  }
});
