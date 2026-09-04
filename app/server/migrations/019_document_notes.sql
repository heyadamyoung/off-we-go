-- A document is more than its bytes: "the QR at the BACK of the PDF", "this
-- one is the return leg", "printed copy in the grey bag". One free-text note
-- per document, on both homes.
alter table segment_documents add column note text;
alter table stop_documents add column note text;
