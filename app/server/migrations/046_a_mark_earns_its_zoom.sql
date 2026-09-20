/* The zoom a place earns, stored on the place.
 *
 * It used to be arithmetic on the category: museum 11.5, café 15.5, plus a
 * nudge for confidence. That is a table, and a table cannot know how much is
 * around. The same rule ran in central Amsterdam, where a hundred and
 * sixty-eight thousand places all qualified and a per-tile cap threw away
 * whatever did not fit, and on the Isle of Skye, where thirteen hundred
 * places are mostly guest houses and errands and nothing was allowed on
 * screen until you were nearly on top of it. A cluster of dots and an empty
 * island, from one rule, because the rule never looked at the density.
 *
 * So it is computed now — see places/store.js assignLabelZoom — from where a
 * place comes among its neighbours in the square it shares with them. Being
 * a column rather than an expression is the point: a tile is then
 * `label_zoom <= z` with no cap, and a mark that has appeared cannot vanish
 * as you zoom further in.
 *
 * Null until computed, which reads as "not yet on the map". The ingest fills
 * it inside the same transaction as the places themselves, so a cell is never
 * visible without it. */
alter table places add column if not exists label_zoom real;

/* Every tile again, for the same reason as migration 045: the ones already
   built were encoded from the old rule and none of the above corrects a row
   that is already bytes. They are a cache. */
truncate table place_tiles;
