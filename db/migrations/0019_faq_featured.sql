-- Lets a university deliberately curate which FAQs the widget suggests as starter chips, instead of it being
-- an accident of FAQ creation order (the widget config query previously just took the first 4 approved FAQs by id).
ALTER TABLE faqs ADD COLUMN featured boolean NOT NULL DEFAULT false;
