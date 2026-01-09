-- Migration: add_sync_cursor_to_plaid_items
-- Description: Add sync_cursor column for /transactions/sync API pagination
-- Date: 2026-01-08

ALTER TABLE plaid_items ADD COLUMN sync_cursor TEXT;
