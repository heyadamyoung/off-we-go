// ---------------------------------------------------------------------------
// Mock trip data. Every coordinate is a real place in Amsterdam.
// Bundled sample data used when no VPS API URL is configured.
// ---------------------------------------------------------------------------

// Topical Creative-Commons photography, with a guaranteed-available fallback.
//
// Sizes are snapped to a three-rung ladder so one photo resolves to ONE url per rung
// no matter where it is rendered. This matters more than it looks: loremflickr answers
// with a 302 and bakes the dimensions into the resized filename, so asking for the same
// picture at 160x160, 200x160, 300x200, 300x230, 420x220, 520x400 and 1200x900 is seven
// separate redirect-plus-refetch round trips (~0.7s each) for one image. Snapped, the
// whole app shares a thumb and a card, and only the full-screen viewer pulls the large.
const LADDER = [
  { w: 400,  h: 300 },   // thumb — map stacks, filmstrips, timeline, hero thumbrow
  { w: 800,  h: 600 },   // card  — hero image, photo grid, filmstrip covers
  { w: 1280, h: 960 },   // full  — the photo viewer only
];
const snap = (w, h) => {
  const want = Math.max(w, h);
  return LADDER.find(r => r.w >= want) || LADDER[LADDER.length - 1];
};

export const pic = (kw, lock, w = 1200, h = 800) => {
  const r = snap(w, h);
  return `https://loremflickr.com/${r.w}/${r.h}/${kw}?lock=${lock}`;
};
export const picFallback = (seed, w = 1200, h = 800) => {
  const r = snap(w, h);
  return `https://picsum.photos/seed/${seed}/${r.w}/${r.h}`;
};

export const FAMILY = [
  { id: 'u1', handle: 'maya', name: 'Maya', role: 'Travelling', avatar: 'https://randomuser.me/api/portraits/women/44.jpg' },
  { id: 'u2', handle: 'alex', name: 'Alex', role: 'Travelling', avatar: 'https://randomuser.me/api/portraits/men/46.jpg' },
  { id: 'u3', handle: 'zoe', name: 'Zoe', role: 'Travelling', avatar: 'https://randomuser.me/api/portraits/women/85.jpg' },
  { id: 'u4', handle: 'grandma-jo', name: 'Grandma Jo', role: 'Following', avatar: 'https://randomuser.me/api/portraits/women/68.jpg' },
  { id: 'u5', handle: 'uncle-kai', name: 'Uncle Kai', role: 'Following', avatar: 'https://randomuser.me/api/portraits/men/32.jpg' },
  { id: 'u6', handle: 'aunt-nia', name: 'Aunt Nia', role: 'Following', avatar: 'https://randomuser.me/api/portraits/women/12.jpg' },
];
export const byName = n => FAMILY.find(f => f.name === n) || FAMILY[0];

export const TRIP = {
  title: 'Amsterdam Weekend',
  crew: 'Sample Family',
  dates: '4 – 16 September',
  dayIndex: 2, dayCount: 13,
};

export const STOPS = [
  { id:'s1', name:'Schiphol Airport', kind:'Transport', icon:'plane', day:'Fri 4 Sep', time:'08:30 – 10:00',
    lng:4.7639, lat:52.3105, status:'done', kw:'airport,terminal', lock:41,
    note:'Wheels down. The train to Centraal takes seventeen minutes and she slept through all of it.' },
  { id:'s2', name:'Hotel Jakarta', kind:'Stay', icon:'bed', day:'Fri 4 Sep', time:'Check-in 14:00',
    lng:4.9350, lat:52.3793, status:'done', kw:'hotel,lobby,plants', lock:12,
    note:'Our base for three nights. An indoor jungle in the atrium and harbour views from the top floor.' },
  { id:'s3', name:'Canal cruise', kind:'Activity', icon:'boat', day:'Fri 4 Sep', time:'18:30 – 20:00',
    lng:4.8840, lat:52.3740, status:'done', kw:'amsterdam,canal,boat', lock:7,
    note:'An open boat through the Jordaan at golden hour. Best hour of the trip so far, by a distance.' },
  { id:'s4', name:'Rijksmuseum', kind:'Sight', icon:'museum', day:'Sat 5 Sep', time:'09:30 – 12:30',
    lng:4.8852, lat:52.3600, status:'done', kw:'rijksmuseum,amsterdam', lock:23,
    note:'The Night Watch, the Cuypers Library, and roughly nine hundred stairs. Worth every one.' },
  { id:'s5', name:'Foodhallen', kind:'Food', icon:'food', day:'Sat 5 Sep', time:'13:00 – 14:30',
    lng:4.8686, lat:52.3664, status:'now', kw:'food,market,hall', lock:55,
    note:'Indoor food market in an old tram depot. Bitterballen for the kiddo, natural wine for the grown-ups.' },
  { id:'s6', name:'Anne Frank House', kind:'Sight', icon:'museum', day:'Sat 5 Sep', time:'15:45 – 17:00',
    lng:4.8840, lat:52.3752, status:'next', kw:'amsterdam,house,canal', lock:31,
    note:'Timed entry at 15:45. A quiet visit — we talked with her about it beforehand.' },
  { id:'s7', name:'NEMO Science Museum', kind:'Sight', icon:'museum', day:'Sun 6 Sep', time:'10:00 – 13:00',
    lng:4.9124, lat:52.3742, status:'planned', kw:'science,museum', lock:18,
    note:'Hands-on everything, plus the best free rooftop view in the city.' },
  { id:'s8', name:'Bikes in Vondelpark', kind:'Activity', icon:'walk', day:'Sun 6 Sep', time:'15:00 – 18:00',
    lng:4.8687, lat:52.3579, status:'planned', kw:'park,bicycle', lock:9,
    note:'Rent three bikes, picnic by the pond, attempt not to be flattened by a Dutch commuter.' },
];

export const PHOTOS = [
  { id:'p1', stopId:'s4', lng:4.8856, lat:52.3603, by:'Maya', when:'Today · 10:42',
    caption:'In front of The Night Watch', kw:'rijksmuseum,painting', lock:23, seed:'rk1' },
  { id:'p2', stopId:'s4', lng:4.8846, lat:52.3596, by:'Alex', when:'Today · 11:15',
    caption:'The Cuypers Library — she went very quiet in here', kw:'library,books', lock:66, seed:'rk2' },
  { id:'p3', stopId:'s4', lng:4.8861, lat:52.3594, by:'Zoe', when:'Today · 11:50',
    caption:'My favourite painting in the whole place', kw:'painting,gallery', lock:14, seed:'rk3' },
  { id:'p4', stopId:'s4', lng:4.8840, lat:52.3607, by:'Maya', when:'Today · 12:20',
    caption:'Museumplein on the way out', kw:'amsterdam,square', lock:5, seed:'rk4' },
  { id:'p5', stopId:'s4', lng:4.8834, lat:52.3599, by:'Alex', when:'Today · 12:28',
    caption:'Bikes, obviously. Hundreds of them.', kw:'amsterdam,bicycle', lock:77, seed:'rk5' },
  { id:'p6', stopId:'s5', lng:4.8689, lat:52.3661, by:'Alex', when:'Today · 13:24',
    caption:'Bitterballen. Enough said.', kw:'food,fried,snack', lock:34, seed:'fd1' },
  { id:'p7', stopId:'s5', lng:4.8681, lat:52.3668, by:'Zoe', when:'Today · 13:31',
    caption:'Dad ordered something green by accident', kw:'market,food,stall', lock:52, seed:'fd2' },
  { id:'p8', stopId:'s3', lng:4.8834, lat:52.3737, by:'Maya', when:'Yesterday · 19:12',
    caption:'Golden hour on the Prinsengracht', kw:'amsterdam,canal,sunset', lock:3, seed:'cn1' },
  { id:'p9', stopId:'s3', lng:4.8847, lat:52.3746, by:'Alex', when:'Yesterday · 19:38',
    caption:'Every single bridge, photographed', kw:'canal,bridge', lock:61, seed:'cn2' },
  { id:'p10', stopId:'s2', lng:4.9347, lat:52.3796, by:'Zoe', when:'Yesterday · 15:10',
    caption:'Room 704, best window in the building', kw:'hotel,window,view', lock:28, seed:'ht1' },
  { id:'p11', stopId:'s1', lng:4.7645, lat:52.3110, by:'Maya', when:'Fri · 09:52',
    caption:'Wheels down in Amsterdam', kw:'airport,plane,window', lock:44, seed:'ap1' },
];

export const SEED_COMMENTS = {
  p3: [
    { id:'c1', by:'Grandma Jo', text:'Well spotted, Zoe. You have a good eye.', when:'1 h ago' },
    { id:'c2', by:'Uncle Kai',  text:'Did you make it to the library bit? Best room in the building.', when:'52 min ago' },
    { id:'c3', by:'Maya',       text:'We did — photo 2. She was not impressed.', when:'40 min ago' },
  ],
  p1: [ { id:'c4', by:'Grandma Jo', text:'Look at the size of it! Give her a squeeze from me.', when:'2 h ago' } ],
  p6: [ { id:'c5', by:'Aunt Nia', text:'I am extremely jealous of that plate.', when:'8 min ago' } ],
  p8: [ { id:'c6', by:'Uncle Kai', text:'Now that is a postcard.', when:'Yesterday' } ],
};

// Walked route — follows the real streets from the hotel through the centre.
export const ROUTE = [
  [4.9350,52.3793],[4.9297,52.3801],[4.9231,52.3799],[4.9160,52.3794],[4.9081,52.3789],
  [4.9003,52.3791],[4.8971,52.3765],[4.8944,52.3742],[4.8916,52.3719],[4.8893,52.3691],
  [4.8874,52.3660],[4.8862,52.3628],[4.8852,52.3600],[4.8836,52.3594],[4.8809,52.3592],
  [4.8788,52.3601],[4.8779,52.3622],[4.8762,52.3638],[4.8735,52.3646],[4.8709,52.3655],[4.8686,52.3664],
];
// Where the live marker wanders next while you watch (towards Anne Frank House).
export const AHEAD = [
  [4.8692,52.3672],[4.8703,52.3681],[4.8718,52.3690],[4.8736,52.3699],[4.8755,52.3707],
  [4.8774,52.3714],[4.8793,52.3722],[4.8812,52.3731],[4.8828,52.3742],[4.8840,52.3752],
];


