/* One film at one size is a bet that everybody watching has the same
   connection, and a trip is where that bet loses: somebody is on hotel wifi
   and somebody is on a train through a valley. The second one waits through a
   buffering spinner for a film the first is already watching, or gives up.

   So a film is also published as an adaptive stream — the same footage at
   several sizes, cut into segments, with a playlist the player uses to change
   its mind every few seconds. The single MP4 stays exactly where it was: it
   is what a browser without streaming support plays, and it is what is left
   if the ladder was never built. */
alter table photos add column if not exists hls_path text;

/* Only a film has renditions. A photograph with a playlist would be a bug
   that showed up as a broken player rather than as an error. */
alter table photos drop constraint if exists photos_hls_is_video;
alter table photos add constraint photos_hls_is_video
  check (hls_path is null or media_kind = 'video');

/* Building the ladder is its own job, not part of the conversion.

   They fail differently and are worth different things: the conversion is
   what makes a film playable at all, and the ladder only makes it play
   better. A ladder that will not build must not cost a film its conversion,
   and it must not queue behind one either — so it has its own row, its own
   attempts and its own backoff, and the day this moves to a fleet with
   hardware encoders it moves on its own. */
alter table media_jobs drop constraint if exists media_jobs_kind_known;
alter table media_jobs add constraint media_jobs_kind_known
  check (kind in ('transcode', 'hls'));
