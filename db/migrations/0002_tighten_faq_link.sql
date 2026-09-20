-- Make unanswered_questions.linked_faq_id tenant-safe (composite FK).
ALTER TABLE faqs
  ADD CONSTRAINT faqs_tenant_id_id_key UNIQUE (tenant_id, id);

ALTER TABLE unanswered_questions
  DROP CONSTRAINT unanswered_questions_linked_faq_id_fkey;

ALTER TABLE unanswered_questions
  ADD CONSTRAINT unanswered_questions_linked_faq_fk
  FOREIGN KEY (tenant_id, linked_faq_id) REFERENCES faqs (tenant_id, id)
  ON DELETE SET NULL (linked_faq_id);