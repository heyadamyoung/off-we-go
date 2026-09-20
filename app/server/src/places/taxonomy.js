/* Upstream categories, in the twenty words a traveller uses.
 *
 * Overture files places under about two thousand leaf categories — a sample of
 * ninety-eight thousand rows turned up 1,224 distinct ones, from `restaurant`
 * to `taco_restaurant` to `psychic_advising`. No traveller wants a filter with
 * two thousand entries, and no ranking can weigh a list nobody has read.
 *
 * Happily the data carries a coarser field beside it, `basic_category`, whose
 * whole vocabulary is 255 values. That is small enough to map by hand and
 * read afterwards, which is the only kind of mapping worth trusting: every
 * value below was taken from the data, not imagined, and anything the next
 * release adds falls through to a rule or to `other` rather than to a guess.
 *
 * Precedence, and why:
 *   1. the leaf category, where it names something the coarse one cannot —
 *      `viewpoint` and `scenic_lookout` both land under vague coarse values,
 *      and they are exactly what "sights nearby" is for
 *   2. the coarse category, which is right nearly always
 *   3. the leaf category again, through the suffix rules, for anything the
 *      coarse field left blank or vague
 *   4. `other`, which ranks low but is never hidden: unknown is not junk
 */

/** The twenty. Ordered as a person would read them, not alphabetically. */
export const CATEGORIES = Object.freeze([
  'sights',
  'viewpoint',
  'museum',
  'gallery',
  'historic',
  'religious',
  'nature',
  'beach',
  'food',
  'cafe',
  'bar',
  'market',
  'lodging',
  'shopping',
  'entertainment',
  'sport',
  'transit',
  'services',
  'health',
  'other',
])

const CATEGORY_SET = new Set(CATEGORIES)
export const isCategory = value => CATEGORY_SET.has(value)

/* Every `basic_category` Overture emitted across the sample, grouped by the
   word we file it under. Listed by target rather than by source so the
   groupings can be argued with: this is the file somebody will open to ask
   "why is a library not a sight". */
const BY_CATEGORY = Object.freeze({
  sights: [
    'public_plaza',
    'bridge',
    'public_fountain',
    'sculpture_statue',
    'lighthouse',
    'pier',
    'street_art',
    'built_feature',
    'rural_attraction',
    'cultural_center',
  ],
  museum: ['museum', 'planetarium', 'science_attraction'],
  gallery: ['art_gallery', 'arts_and_crafts_space'],
  historic: ['historic_site', 'monument', 'castle', 'fort', 'military_site', 'cemetery'],
  religious: [
    'christian_place_of_worship',
    'buddhist_place_of_worship',
    'hindu_place_of_worship',
    'muslim_place_of_worship',
    'jewish_place_of_worship',
    'place_of_worship',
    'religious_organization',
    'religious_landmark',
  ],
  nature: [
    'park',
    'national_park',
    'nature_reserve',
    'forest',
    'garden',
    'lake',
    'river',
    'mountain',
    'waterfall',
    'island',
    'canal',
    'hot_springs',
    'dog_park',
    'land_feature',
    'geographic_entities',
    'playground',
    'recreational_trail_or_path',
  ],
  beach: ['beach'],
  food: [
    'restaurant',
    'casual_eatery',
    'fast_food_restaurant',
    'food_truck_stand',
    'food_court',
    'food_and_drink',
    'food_service',
  ],
  cafe: ['cafe', 'coffee_shop', 'non_alcoholic_beverage_venue', 'smoothie_juice_bar'],
  bar: [
    'bar',
    'alcoholic_beverage_venue',
    'lounge',
    'brewery',
    'winery',
    'distillery',
    'nightlife_venue',
    'dance_club',
  ],
  market: ['farmers_market', 'market'],
  lodging: [
    'hotel',
    'lodging',
    'resort',
    'bed_and_breakfast',
    'private_lodging',
    'inn',
    'campground',
    'rv_park',
  ],
  shopping: [
    'fashion_and_apparel_store',
    'hardware_home_and_garden_store',
    'electronics_store',
    'convenience_store',
    'flowers_and_gifts_store',
    'vehicle_parts_store',
    'personal_care_and_beauty_store',
    'sporting_goods_store',
    'arts_crafts_and_hobby_store',
    'shopping_mall',
    'shopping',
    'books_music_and_video_store',
    'animal_and_pet_store',
    'specialty_store',
    'second_hand_store',
    'department_store',
    'toys_and_games_store',
    'office_supply_store',
    'musical_instrument_and_pro_audio_store',
    'discount_store',
    'superstore',
    'warehouse_club_store',
    'food_and_beverage_store',
  ],
  entertainment: [
    'arts_and_entertainment',
    'movie_theater',
    'theatre_venue',
    'performing_arts_venue',
    'music_venue',
    'comedy_club',
    'casino',
    'gaming_venue',
    'arcade',
    'amusement_park',
    'amusement_attraction',
    'zoo',
    'aquarium',
    'animal_attraction',
    'adult_entertainment_venue',
    'event_venue',
    'fairgrounds',
    'rodeo',
  ],
  sport: [
    'gym',
    'sport_or_fitness_facility',
    'fitness_studio',
    'sports_and_recreation',
    'sport_field',
    'sport_court',
    'sport_league',
    'sport_team',
    'sport_or_recreation_club',
    'stadium_arena',
    'swimming_pool',
    'golf_course',
    'skate_park',
    'skating_rink',
    'marina',
  ],
  transit: [
    'airport',
    'air_transport_facility_or_service',
    'train_station',
    'public_transit_facility_or_service',
    'rail_facility_or_service',
    'taxi_or_ride_share_service',
    'parking',
    'travel_and_transportation',
    'gas_station',
    'fueling_station',
    'ev_charging_station',
  ],
  health: [
    'hospital',
    'health_care',
    'dental_clinic',
    'pharmacy_and_drug_store',
    'specialized_health_care',
    'diagnostics_imaging_or_lab_service',
    'behavioral_or_mental_health_clinic',
    'complementary_and_alternative_medicine',
    'physical_medicine_and_rehabilitation',
    'outpatient_care_facility',
    'vision_or_eye_care_clinic',
    'medical_service',
    'surgery',
    'pediatric_clinic',
    'primary_care_or_general_clinic',
    'reproductive_perinatal_and_womens_care',
    'specialized_medical_facility',
    'specialty_hospital',
    'emergency_department',
    'emergency_or_urgent_care_facility',
    'urgent_care_clinic',
    'walk_in_clinic',
  ],
  services: [
    'professional_service',
    'real_estate_service',
    'home_service',
    'personal_or_beauty_service',
    'wellness_service',
    'event_or_party_service',
    'automotive_service',
    'financial_service',
    'bank_or_credit_union',
    'atm',
    'travel_service',
    'technical_service',
    'building_or_construction_service',
    'government_office',
    'government_department',
    'courthouse',
    'police_station',
    'fire_station',
    'jail_or_prison',
    'embassy',
    'media_service',
    'attorney_or_law_firm',
    'legal_service',
    'rental_service',
    'design_service',
    'b2b_service',
    'printing_service',
    'laundry_service',
    'shipping_or_delivery_service',
    'manufacturer',
    'corporate_or_business_office',
    'agricultural_service',
    'farm',
    'industrial_facility_or_service',
    'security_service',
    'telecommunications_service',
    'electric_utility_provider',
    'water_utility_provider',
    'natural_gas_utility_provider',
    'public_utility',
    'environmental_or_ecological_service',
    'animal_or_pet_service',
    'vehicle_service',
    'auto_dealer',
    'vehicle_dealer',
    'storage_facility',
    'warehouse',
    'social_or_community_service',
    'community_and_government',
    'community_center',
    'civic_center',
    'civic_organization',
    'social_club',
    'youth_organization',
    'labor_union',
    'political_organization',
    'research_institute',
    'radio_station',
    'television_station',
    'military_base',
    'campus_building',
    'public_restroom',
    'psychic_advising',
    'astrological_advising',
    'spiritual_advising',
    'housing_or_property_service',
    'family_service',
    'tutoring_service',
    'specialty_school',
    'place_of_learning',
    'education',
    'educational_service',
    'educational_facility',
    'preschool',
    'elementary_school',
    'middle_school',
    'high_school',
    'college_university',
    'library',
    'food_bank',
    'senior_living_facility',
    'recreational_equipment_rental',
    'wholesaler',
    'supplier_or_distributor',
    'b2b_transportation_and_storage_service',
    'b2b_office_and_professional_service',
    'b2b_industrial_and_machine_service',
    'b2b_science_and_technology_service',
    'b2b_energy_and_utility_service',
  ],
  other: ['apartment', 'condominium'],
})

/** basic_category → ours, flattened once at load. */
const BASIC = Object.freeze(
  Object.fromEntries(
    Object.entries(BY_CATEGORY).flatMap(([category, values]) =>
      values.map(value => [value, category]),
    ),
  ),
)

/* Coarse values that describe a sector rather than a place. When one of these
   is all we have, the leaf category is asked before settling.

   Kept deliberately short. An earlier version also listed professional_service,
   health_care, education and lodging, which are perfectly good answers — and
   sending them to the leaf rules put a bar association under `bar`. A coarse
   value is only vague when it spans categories we care to tell apart. */
const VAGUE = new Set([
  'shopping',
  'arts_and_entertainment',
  'travel_and_transportation',
  'geographic_entities',
  'community_and_government',
  'specialty_store',
  'sports_and_recreation',
  'food_and_drink',
])

/* Leaf rules that name something the coarse field structurally cannot: a
   viewpoint and a museum both sit under coarse values that say only "arts" or
   "geography". These alone are read *before* the coarse value. */
const SIGHT_RULES = Object.freeze([
  [/(^|_)(viewpoint|scenic_lookout|observation_deck|overlook|panorama)($|_)/, 'viewpoint'],
  [/(^|_)(museum|planetarium)($|_)/, 'museum'],
  [/(^|_)art_gallery($|_)|(^|_)gallery$/, 'gallery'],
  [
    /(^|_)(monument|memorial|castle|palace|ruins?|archaeolog\w*|historic\w*)($|_)|(^|_)fort$/,
    'historic',
  ],
  [/(^|_)(church|cathedral|mosque|synagogue|temple|shrine|chapel|basilica)($|_)/, 'religious'],
  [/(^|_)beach$/, 'beach'],
])

/* The rest, read only when the coarse value was missing or too vague to use.
 *
 * Order is load-bearing: `theme_park` and `skate_park` must be claimed by
 * entertainment and sport before the generic outdoors rule sees the word
 * "park". So specific-and-built comes first, open-air last.
 *
 * Anchoring is load-bearing too. A bare `bar` alternative matched the front of
 * `bar_association` and filed a law firm under drinks; the short ambiguous
 * words are therefore anchored to the end of the value, where the head noun
 * of these names actually sits — `wine_bar` and `sports_bar` still match,
 * `bar_association` does not.
 */
const LEAF_RULES = Object.freeze([
  ...SIGHT_RULES,
  [
    /(^|_)(zoo|aquarium|theatre|theater|cinema|casino|amusement\w*|theme_park|nightlife|arcade)($|_)/,
    'entertainment',
  ],
  [
    /(^|_)(skate_park|golf_course|stadium|gym|fitness|swimming_pool)($|_)|(^|_)(gym|pool|sports?)$/,
    'sport',
  ],
  [/(^|_)(cafe|coffee\w*|patisserie|juice_bar|tea_house)($|_)/, 'cafe'],
  [/(^|_)(brewery|winery|distillery|nightclub|cocktail\w*|taproom)($|_)|(^|_)(bar|pub)$/, 'bar'],
  [
    /(^|_)(restaurant|eatery|diner|bistro|steakhouse|brasserie|canteen|food_truck|pizzeria|bakery|deli|ice_cream|dessert\w*)($|_)/,
    'food',
  ],
  [/(^|_)(farmers?_market|bazaar)($|_)|(^|_)market$/, 'market'],
  [
    /(^|_)(hotel|hostel|motel|guest_house|resort|campground|bed_and_breakfast)($|_)|(^|_)inn$/,
    'lodging',
  ],
  [
    /(^|_)(airport|terminal|ferry|metro|subway|tram|bus_stop|parking|rv_park|car_park)($|_)|(^|_)station$/,
    'transit',
  ],
  [/(^|_)(hospital|clinic|pharmacy|dentist|doctor|physician|medical)($|_)/, 'health'],
  [/(^|_)(store|shop|boutique|mall|supermarket|dealer)($|_)/, 'shopping'],
  [
    /(^|_)(national_park|nature_reserve|garden|forest|lake|river|waterfall|mountain|island|trail)($|_)|(^|_)park$/,
    'nature',
  ],
])

const clean = value =>
  String(value ?? '')
    .trim()
    .toLowerCase()

/**
 * The category we file a place under.
 *
 * @param {{basic?: string|null, leaf?: string|null}} upstream
 * @returns {string} one of CATEGORIES
 */
export function categoryFor({ basic, leaf } = {}) {
  const coarse = clean(basic)
  const specific = clean(leaf)

  /* 1. The leaf where it knows something the coarse field cannot. Only the
        sight rules qualify — the rest merely restate what the coarse value
        already said correctly, and reading them here let the word "park" in
        `theme_park` beat a coarse value that had it right. */
  if (specific) {
    for (const [pattern, category] of SIGHT_RULES) {
      if (pattern.test(specific)) return category
    }
  }
  // 2. The coarse value, which is right nearly always.
  const fromBasic = BASIC[coarse]
  if (fromBasic && !VAGUE.has(coarse)) return fromBasic
  // 3. The leaf, through every rule.
  if (specific) {
    for (const [pattern, category] of LEAF_RULES) if (pattern.test(specific)) return category
  }
  // 4. A vague coarse value still beats nothing.
  return fromBasic || 'other'
}

/* Categories that a source could reasonably call the other, for the merge in
   resolve.js: one dataset's "bar" is another's "restaurant", and a museum in a
   castle is filed both ways by honest people. Families overlap on purpose. */
const FAMILIES = Object.freeze([
  ['food', 'cafe', 'bar', 'market'],
  ['sights', 'viewpoint', 'museum', 'gallery', 'historic', 'religious', 'entertainment'],
  ['nature', 'viewpoint', 'beach', 'sport'],
  ['shopping', 'market', 'services'],
  ['lodging', 'services'],
  ['transit', 'services'],
  ['health', 'services'],
])

/** Whether two of our categories are near enough that one source calling it
    the other is a difference of opinion rather than of place. */
export function relatedCategories(a, b) {
  if (a === b) return true
  return FAMILIES.some(family => family.includes(a) && family.includes(b))
}
