alter table photos add constraint photos_coordinates_valid
  check (
    (lng is null and lat is null)
    or (lng between -180 and 180 and lat between -90 and 90)
  ) not valid;

create sequence if not exists photo_order_seq;
select setval('photo_order_seq', greatest(coalesce(max(seq), 0) + 1, 1), false) from photos;
alter table photos alter column seq set default nextval('photo_order_seq');
