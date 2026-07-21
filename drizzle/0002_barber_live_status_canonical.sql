-- [E8] Satukan kamus status kehadiran barber.
-- Sebelum ini app barber menulis online|offline|unavailable sedangkan admin &
-- lifecycle memakai available|serving|on_break|offline, sehingga nilai yang
-- sama berarti hal berbeda tergantung siapa yang membacanya.
-- Kamus kanonik: available | serving | on_break | offline.
-- Pemetaan: online -> available, unavailable -> on_break, sisanya -> offline.
UPDATE barbers SET live_status = 'available' WHERE live_status = 'online';
--> statement-breakpoint
UPDATE barbers SET live_status = 'on_break' WHERE live_status = 'unavailable';
--> statement-breakpoint
UPDATE barbers SET live_status = 'offline'
WHERE live_status IS NULL
   OR live_status NOT IN ('available', 'serving', 'on_break', 'offline');
