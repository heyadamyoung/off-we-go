-- A pause the phone reports is a fact the viewer may be told. Silence is not:
-- without this column the app could only guess from fix age, and guessing
-- labels "battery died in a tunnel" the same as "she turned it off".
alter table devices add column if not exists paused_at timestamptz;
