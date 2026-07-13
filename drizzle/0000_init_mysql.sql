CREATE TABLE `appointment_events` (
	`id` char(36) NOT NULL,
	`appointment_id` char(36) NOT NULL,
	`event_type` varchar(50) NOT NULL,
	`from_status` enum('pending','confirmed','in_queue','in_service','completed','cancelled','no_show'),
	`to_status` enum('pending','confirmed','in_queue','in_service','completed','cancelled','no_show') NOT NULL,
	`actor_type` varchar(20) NOT NULL,
	`actor_id` char(36),
	`actor_role` varchar(30),
	`reason` text NOT NULL,
	`metadata` json,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `appointment_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `appointment_products` (
	`id` char(36) NOT NULL,
	`appointment_id` char(36) NOT NULL,
	`product_id` char(36) NOT NULL,
	`quantity` int NOT NULL,
	`unit_price` bigint NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `appointment_products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `appointment_services` (
	`id` char(36) NOT NULL,
	`appointment_id` char(36) NOT NULL,
	`service_id` char(36) NOT NULL,
	`price_amount` bigint NOT NULL,
	`duration_min` int NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `appointment_services_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `appointments` (
	`id` char(36) NOT NULL,
	`branch_id` char(36) NOT NULL,
	`barber_id` char(36),
	`customer_id` char(36),
	`source` enum('online_booking','walk_in') NOT NULL,
	`status` enum('pending','confirmed','in_queue','in_service','completed','cancelled','no_show') NOT NULL,
	`scheduled_at` datetime(6),
	`queue_position` int,
	`checked_in_at` datetime(6),
	`started_at` datetime(6),
	`completed_at` datetime(6),
	`cancellation_reason` text,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`customer_media_urls` json NOT NULL DEFAULT ('[]'),
	`fulfillment_type` varchar(20) NOT NULL DEFAULT 'in_store',
	`service_address` text,
	`destination_latitude` decimal(10,8),
	`destination_longitude` decimal(11,8),
	`location_notes` text,
	`journey_status` varchar(30) NOT NULL DEFAULT 'not_started',
	`version` int NOT NULL DEFAULT 1,
	`scheduled_end_at` datetime(6),
	`idempotency_key` varchar(128),
	`travel_buffer_min` int NOT NULL DEFAULT 0,
	`schedule_block_start_at` datetime(6),
	`schedule_block_end_at` datetime(6),
	`chat_cleared_at` datetime(6),
	CONSTRAINT `appointments_id` PRIMARY KEY(`id`),
	CONSTRAINT `appointments_idempotency_key_unique` UNIQUE(`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` char(36) NOT NULL,
	`actor_type` varchar(50) NOT NULL,
	`actor_id` char(36) NOT NULL,
	`action` varchar(100) NOT NULL,
	`entity_type` varchar(50) NOT NULL,
	`entity_id` char(36) NOT NULL,
	`before` json,
	`after` json,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`branch_id` char(36),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `auth_events` (
	`id` char(36) NOT NULL,
	`user_type` varchar(20) NOT NULL,
	`user_id` char(36),
	`event_type` varchar(50) NOT NULL,
	`success` boolean NOT NULL,
	`identifier_hash` varchar(64),
	`ip_hash` varchar(64),
	`metadata` json,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `auth_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` char(36) NOT NULL,
	`user_type` varchar(20) NOT NULL,
	`user_id` char(36) NOT NULL,
	`refresh_jti_hash` varchar(64) NOT NULL,
	`user_agent` text,
	`ip_hash` varchar(64),
	`expires_at` datetime(6) NOT NULL,
	`last_used_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`revoked_at` datetime(6),
	`revoke_reason` varchar(100),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `auth_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `barber_daily_stats` (
	`id` char(36) NOT NULL,
	`barber_id` char(36) NOT NULL,
	`branch_id` char(36) NOT NULL,
	`summary_date` date NOT NULL,
	`heads_count` int DEFAULT 0,
	`revenue` bigint DEFAULT 0,
	`commission_earned` bigint DEFAULT 0,
	`avg_rating` decimal(3,2) DEFAULT '0',
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `barber_daily_stats_id` PRIMARY KEY(`id`),
	CONSTRAINT `barber_daily_stats_barber_date_unique` UNIQUE(`barber_id`,`summary_date`)
);
--> statement-breakpoint
CREATE TABLE `barber_open_orders` (
	`id` char(36) NOT NULL,
	`barber_id` char(36) NOT NULL,
	`branch_id` char(36) NOT NULL,
	`order_date` date NOT NULL,
	`start_time` time NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `barber_open_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `barber_open_orders_unique` UNIQUE(`barber_id`,`order_date`,`start_time`)
);
--> statement-breakpoint
CREATE TABLE `barber_payouts` (
	`id` char(36) NOT NULL,
	`barber_id` char(36) NOT NULL,
	`period_start` datetime(6) NOT NULL,
	`period_end` datetime(6) NOT NULL,
	`total_amount` bigint NOT NULL,
	`status` varchar(50) NOT NULL,
	`paid_at` datetime(6),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `barber_payouts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `barber_portfolios` (
	`id` char(36) NOT NULL,
	`barber_id` char(36) NOT NULL,
	`image_url` text NOT NULL,
	`caption` text,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `barber_portfolios_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `barber_time_off` (
	`id` char(36) NOT NULL,
	`barber_id` char(36) NOT NULL,
	`start_at` datetime(6) NOT NULL,
	`end_at` datetime(6) NOT NULL,
	`reason` text,
	`status` varchar(20) NOT NULL DEFAULT 'approved',
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `barber_time_off_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `barber_wallets` (
	`id` char(36) NOT NULL,
	`barber_id` char(36) NOT NULL,
	`balance` decimal(12,2) NOT NULL DEFAULT '0',
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `barber_wallets_id` PRIMARY KEY(`id`),
	CONSTRAINT `barber_wallets_barber_id_key` UNIQUE(`barber_id`)
);
--> statement-breakpoint
CREATE TABLE `barbers` (
	`id` char(36) NOT NULL,
	`staff_user_id` char(36) NOT NULL,
	`branch_id` char(36) NOT NULL,
	`display_name` varchar(255) NOT NULL,
	`bio` text,
	`rating_avg` decimal(3,2) DEFAULT '0',
	`rating_count` int DEFAULT 0,
	`live_status` varchar(50) DEFAULT 'offline',
	`default_commission_rule_id` char(36),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`deleted_at` datetime(6),
	`service_radius_km` int NOT NULL DEFAULT 5,
	`approval_status` varchar(20) NOT NULL DEFAULT 'approved',
	CONSTRAINT `barbers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `branch_expenses` (
	`id` char(36) NOT NULL,
	`branch_id` char(36) NOT NULL,
	`amount` bigint NOT NULL,
	`description` text NOT NULL,
	`expense_date` date NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `branch_expenses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `branch_inventory` (
	`id` char(36) NOT NULL,
	`branch_id` char(36) NOT NULL,
	`product_id` char(36) NOT NULL,
	`quantity_on_hand` int DEFAULT 0,
	`reorder_level` int DEFAULT 0,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `branch_inventory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `branch_operating_hours` (
	`id` char(36) NOT NULL,
	`branch_id` char(36) NOT NULL,
	`day_of_week` int NOT NULL,
	`open_time` time NOT NULL,
	`close_time` time NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `branch_operating_hours_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `branch_photos` (
	`id` char(36) NOT NULL,
	`branch_id` char(36) NOT NULL,
	`url` text NOT NULL,
	`sort_order` int DEFAULT 0,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `branch_photos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `branches` (
	`id` char(36) NOT NULL,
	`region_id` char(36),
	`name` varchar(255) NOT NULL,
	`address` text,
	`phone` varchar(50),
	`latitude` decimal(10,8),
	`longitude` decimal(11,8),
	`is_active` boolean DEFAULT true,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`deleted_at` datetime(6),
	CONSTRAINT `branches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cash_drawer_sessions` (
	`id` char(36) NOT NULL,
	`branch_id` char(36) NOT NULL,
	`opened_at` datetime(6) NOT NULL,
	`closed_at` datetime(6),
	`starting_cash` bigint NOT NULL,
	`ending_cash` bigint,
	`expected_cash` bigint,
	`difference` bigint,
	`status` varchar(50) NOT NULL DEFAULT 'open',
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `cash_drawer_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` char(36) NOT NULL,
	`appointment_id` char(36) NOT NULL,
	`sender_id` char(36) NOT NULL,
	`sender_role` varchar(20) NOT NULL,
	`text` text NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`deleted_at` datetime(6),
	CONSTRAINT `chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `check_ins` (
	`id` char(36) NOT NULL,
	`appointment_id` char(36) NOT NULL,
	`method` varchar(50) NOT NULL,
	`location_lat` decimal(10,8),
	`location_lng` decimal(11,8),
	`checked_in_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`distance_m` decimal(10,2),
	CONSTRAINT `check_ins_id` PRIMARY KEY(`id`),
	CONSTRAINT `check_ins_appointment_unique` UNIQUE(`appointment_id`)
);
--> statement-breakpoint
CREATE TABLE `commission_entries` (
	`id` char(36) NOT NULL,
	`appointment_id` char(36) NOT NULL,
	`commission_rule_id` char(36) NOT NULL,
	`base_amount` bigint NOT NULL,
	`barber_share` bigint NOT NULL,
	`branch_share` bigint NOT NULL,
	`hq_share` bigint NOT NULL,
	`tip_amount` bigint DEFAULT 0,
	`calculated_at` datetime(6) NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `commission_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `commission_entries_appointment_id_unique` UNIQUE(`appointment_id`)
);
--> statement-breakpoint
CREATE TABLE `commission_rules` (
	`id` char(36) NOT NULL,
	`scope` enum('global','region','branch','barber','service') NOT NULL,
	`scope_ref_id` char(36),
	`barber_pct` decimal(5,2) NOT NULL,
	`branch_pct` decimal(5,2) NOT NULL,
	`hq_pct` decimal(5,2) NOT NULL,
	`tip_to_barber` boolean DEFAULT true,
	`effective_from` datetime(6) NOT NULL,
	`effective_to` datetime(6),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `commission_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customer_addresses` (
	`id` char(36) NOT NULL,
	`customer_id` char(36) NOT NULL,
	`service_address` text NOT NULL,
	`location_notes` text,
	`latitude` decimal(10,8) NOT NULL,
	`longitude` decimal(11,8) NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `customer_addresses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customer_wallet_transactions` (
	`id` char(36) NOT NULL,
	`wallet_id` char(36) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`type` varchar(50) NOT NULL,
	`reference_id` char(36),
	`description` text,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `customer_wallet_transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customer_wallets` (
	`id` char(36) NOT NULL,
	`customer_id` char(36) NOT NULL,
	`balance` decimal(12,2) NOT NULL DEFAULT '0',
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `customer_wallets_id` PRIMARY KEY(`id`),
	CONSTRAINT `customer_wallets_customer_id_unique` UNIQUE(`customer_id`)
);
--> statement-breakpoint
CREATE TABLE `customer_withdrawals` (
	`id` char(36) NOT NULL,
	`customer_id` char(36) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`status` varchar(50) NOT NULL DEFAULT 'pending',
	`bank_name` varchar(100) NOT NULL,
	`account_number` varchar(100) NOT NULL,
	`account_name` varchar(150) NOT NULL,
	`rejection_reason` text,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `customer_withdrawals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` char(36) NOT NULL,
	`full_name` varchar(255) NOT NULL,
	`phone` varchar(50) NOT NULL,
	`email` varchar(255),
	`points_balance` bigint DEFAULT 0,
	`is_active` boolean DEFAULT true,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`deleted_at` datetime(6),
	`auth_id` char(36),
	`password_hash` varchar(255),
	CONSTRAINT `customers_id` PRIMARY KEY(`id`),
	CONSTRAINT `customers_email_unique` UNIQUE(`email`),
	CONSTRAINT `customers_phone_unique` UNIQUE(`phone`)
);
--> statement-breakpoint
CREATE TABLE `daily_branch_summaries` (
	`id` char(36) NOT NULL,
	`branch_id` char(36) NOT NULL,
	`summary_date` date NOT NULL,
	`total_revenue` bigint DEFAULT 0,
	`total_appointments` int DEFAULT 0,
	`walk_in_count` int DEFAULT 0,
	`booking_count` int DEFAULT 0,
	`no_show_count` int DEFAULT 0,
	`hq_share_total` bigint DEFAULT 0,
	`branch_share_total` bigint DEFAULT 0,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `daily_branch_summaries_id` PRIMARY KEY(`id`),
	CONSTRAINT `daily_branch_summaries_branch_date_unique` UNIQUE(`branch_id`,`summary_date`)
);
--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` char(36) NOT NULL,
	`branch_id` char(36) NOT NULL,
	`product_id` char(36) NOT NULL,
	`type` varchar(50) NOT NULL,
	`quantity` int NOT NULL,
	`reference_id` char(36),
	`note` text,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `inventory_movements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` char(36) NOT NULL,
	`payment_id` char(36) NOT NULL,
	`invoice_number` varchar(100) NOT NULL,
	`issued_at` datetime(6) NOT NULL,
	`pdf_url` text,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`public_access_token_hash` varchar(64),
	`public_access_expires_at` datetime(6),
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoices_invoice_number_unique` UNIQUE(`invoice_number`)
);
--> statement-breakpoint
CREATE TABLE `media_assets` (
	`id` char(36) NOT NULL,
	`owner_type` varchar(20) NOT NULL,
	`owner_id` char(36) NOT NULL,
	`bucket` varchar(100) NOT NULL,
	`object_path` varchar(512) NOT NULL,
	`visibility` varchar(20) NOT NULL DEFAULT 'private',
	`purpose` varchar(100) NOT NULL,
	`content_type` varchar(100) NOT NULL,
	`size_bytes` bigint NOT NULL,
	`width` int,
	`height` int,
	`deleted_at` datetime(6),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `media_assets_id` PRIMARY KEY(`id`),
	CONSTRAINT `media_assets_object_unique` UNIQUE(`bucket`,`object_path`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`title` varchar(255) NOT NULL,
	`message` text NOT NULL,
	`is_read` boolean DEFAULT false,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`recipient_id` char(36),
	`recipient_type` varchar(50) DEFAULT 'customer',
	`type` varchar(50) DEFAULT 'general',
	`body` text,
	`sent_at` datetime(6) DEFAULT CURRENT_TIMESTAMP(6),
	`read_at` datetime(6),
	`updated_at` datetime(6) DEFAULT CURRENT_TIMESTAMP(6),
	`deleted_at` datetime(6),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` char(36) NOT NULL,
	`appointment_id` char(36) NOT NULL,
	`branch_id` char(36) NOT NULL,
	`total_amount` bigint NOT NULL,
	`service_amount` bigint NOT NULL,
	`product_amount` bigint NOT NULL,
	`discount_amount` bigint DEFAULT 0,
	`tip_amount` bigint DEFAULT 0,
	`method` enum('cash','qris','card','bank_transfer','ewallet') NOT NULL,
	`status` enum('pending','paid','failed','expired','refunded','partially_refunded') NOT NULL,
	`gateway_reference` varchar(255),
	`paid_at` datetime(6),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`service_fee` bigint NOT NULL DEFAULT 0,
	`delivery_fee` bigint NOT NULL DEFAULT 0,
	CONSTRAINT `payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `payments_appointment_id_unique` UNIQUE(`appointment_id`)
);
--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` char(36) NOT NULL,
	`code` varchar(100) NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `permissions_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` char(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`sku` varchar(100) NOT NULL,
	`description` text,
	`base_price` bigint NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`deleted_at` datetime(6),
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_sku_unique` UNIQUE(`sku`)
);
--> statement-breakpoint
CREATE TABLE `promotions` (
	`id` char(36) NOT NULL,
	`title` varchar(255) NOT NULL,
	`subtitle` text,
	`image_url` text,
	`target_url` text,
	`is_active` boolean NOT NULL DEFAULT true,
	`sort_order` int NOT NULL DEFAULT 0,
	`starts_at` datetime(6),
	`ends_at` datetime(6),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`deleted_at` datetime(6),
	CONSTRAINT `promotions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` char(36) NOT NULL,
	`payment_id` char(36) NOT NULL,
	`amount` bigint NOT NULL,
	`reason` text NOT NULL,
	`processed_by` char(36),
	`processed_at` datetime(6) NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `refunds_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `regions` (
	`id` char(36) NOT NULL,
	`code` varchar(50) NOT NULL,
	`name` varchar(255) NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`deleted_at` datetime(6),
	CONSTRAINT `regions_id` PRIMARY KEY(`id`),
	CONSTRAINT `regions_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` char(36) NOT NULL,
	`appointment_id` char(36) NOT NULL,
	`customer_id` char(36) NOT NULL,
	`barber_id` char(36) NOT NULL,
	`rating` decimal(3,2) NOT NULL,
	`comment` text,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `reviews_id` PRIMARY KEY(`id`),
	CONSTRAINT `reviews_appointment_id_unique` UNIQUE(`appointment_id`)
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`id` char(36) NOT NULL,
	`role_id` char(36) NOT NULL,
	`permission_id` char(36) NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `role_permissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` char(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `roles_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `service_prices` (
	`id` char(36) NOT NULL,
	`service_id` char(36) NOT NULL,
	`branch_id` char(36),
	`region_id` char(36),
	`price_amount` bigint NOT NULL,
	`effective_from` datetime(6) NOT NULL,
	`effective_to` datetime(6),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `service_prices_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` char(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`default_duration_min` int NOT NULL,
	`is_active` boolean DEFAULT true,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`deleted_at` datetime(6),
	`image_url` text,
	CONSTRAINT `services_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `staff_user_roles` (
	`id` char(36) NOT NULL,
	`staff_user_id` char(36) NOT NULL,
	`role_id` char(36) NOT NULL,
	`branch_id` char(36),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `staff_user_roles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `staff_users` (
	`id` char(36) NOT NULL,
	`full_name` varchar(255) NOT NULL,
	`email` varchar(255) NOT NULL,
	`phone` varchar(50),
	`is_active` boolean DEFAULT true,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`deleted_at` datetime(6),
	`auth_id` char(36),
	`password_hash` varchar(255),
	CONSTRAINT `staff_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `staff_users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `tracking_sessions` (
	`id` char(36) NOT NULL,
	`appointment_id` char(36) NOT NULL,
	`status` varchar(50) NOT NULL DEFAULT 'active',
	`consent_given_at` datetime(6) NOT NULL,
	`expires_at` datetime(6) NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`ended_at` datetime(6),
	`ended_reason` varchar(100),
	`last_activity_at` datetime(6) DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `tracking_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wallet_topups` (
	`id` char(36) NOT NULL,
	`customer_id` char(36) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`status` varchar(50) NOT NULL DEFAULT 'pending',
	`provider` varchar(50) NOT NULL DEFAULT 'midtrans',
	`method` varchar(50),
	`gateway_reference` varchar(150),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`paid_at` datetime(6),
	CONSTRAINT `wallet_topups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wallet_transactions` (
	`id` char(36) NOT NULL,
	`wallet_id` char(36) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`type` varchar(50) NOT NULL,
	`reference_id` char(36),
	`description` text,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `wallet_transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `withdrawals` (
	`id` char(36) NOT NULL,
	`barber_id` char(36) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`status` varchar(50) NOT NULL DEFAULT 'pending',
	`bank_name` varchar(100) NOT NULL,
	`account_number` varchar(100) NOT NULL,
	`account_name` varchar(150) NOT NULL,
	`rejection_reason` text,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `withdrawals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_notification_settings` (
	`id` char(36) NOT NULL,
	`staff_user_id` char(36) NOT NULL,
	`new_appointment` boolean NOT NULL DEFAULT true,
	`appointment_reminder` boolean NOT NULL DEFAULT true,
	`appointment_cancelled` boolean NOT NULL DEFAULT true,
	`whatsapp` boolean NOT NULL DEFAULT false,
	`email` boolean NOT NULL DEFAULT true,
	`daily_summary` boolean NOT NULL DEFAULT true,
	`weekly_report` boolean NOT NULL DEFAULT false,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `admin_notification_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_notification_settings_staff_user_id_unique` UNIQUE(`staff_user_id`)
);
--> statement-breakpoint
ALTER TABLE `appointment_events` ADD CONSTRAINT `appointment_events_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointment_products` ADD CONSTRAINT `appointment_products_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointment_products` ADD CONSTRAINT `appointment_products_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointment_services` ADD CONSTRAINT `appointment_services_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointment_services` ADD CONSTRAINT `appointment_services_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_barber_id_barbers_id_fk` FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `barber_daily_stats` ADD CONSTRAINT `barber_daily_stats_barber_id_barbers_id_fk` FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `barber_daily_stats` ADD CONSTRAINT `barber_daily_stats_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `barber_open_orders` ADD CONSTRAINT `barber_open_orders_barber_id_barbers_id_fk` FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `barber_open_orders` ADD CONSTRAINT `barber_open_orders_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `barber_payouts` ADD CONSTRAINT `barber_payouts_barber_id_barbers_id_fk` FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `barber_portfolios` ADD CONSTRAINT `barber_portfolios_barber_id_barbers_id_fk` FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `barber_time_off` ADD CONSTRAINT `barber_time_off_barber_id_barbers_id_fk` FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `barber_wallets` ADD CONSTRAINT `barber_wallets_barber_id_barbers_id_fk` FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `barbers` ADD CONSTRAINT `barbers_staff_user_id_staff_users_id_fk` FOREIGN KEY (`staff_user_id`) REFERENCES `staff_users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `barbers` ADD CONSTRAINT `barbers_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `branch_expenses` ADD CONSTRAINT `branch_expenses_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `branch_inventory` ADD CONSTRAINT `branch_inventory_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `branch_inventory` ADD CONSTRAINT `branch_inventory_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `branch_operating_hours` ADD CONSTRAINT `branch_operating_hours_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `branch_photos` ADD CONSTRAINT `branch_photos_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `branches` ADD CONSTRAINT `branches_region_id_regions_id_fk` FOREIGN KEY (`region_id`) REFERENCES `regions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cash_drawer_sessions` ADD CONSTRAINT `cash_drawer_sessions_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `check_ins` ADD CONSTRAINT `check_ins_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `commission_entries` ADD CONSTRAINT `commission_entries_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `commission_entries` ADD CONSTRAINT `commission_entries_commission_rule_id_commission_rules_id_fk` FOREIGN KEY (`commission_rule_id`) REFERENCES `commission_rules`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_addresses` ADD CONSTRAINT `customer_addresses_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_wallet_transactions` ADD CONSTRAINT `customer_wallet_transactions_wallet_id_customer_wallets_id_fk` FOREIGN KEY (`wallet_id`) REFERENCES `customer_wallets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_wallets` ADD CONSTRAINT `customer_wallets_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_withdrawals` ADD CONSTRAINT `customer_withdrawals_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `daily_branch_summaries` ADD CONSTRAINT `daily_branch_summaries_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_payment_id_payments_id_fk` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_payment_id_payments_id_fk` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_processed_by_staff_users_id_fk` FOREIGN KEY (`processed_by`) REFERENCES `staff_users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_barber_id_barbers_id_fk` FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_id_permissions_id_fk` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `service_prices` ADD CONSTRAINT `service_prices_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `service_prices` ADD CONSTRAINT `service_prices_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `service_prices` ADD CONSTRAINT `service_prices_region_id_regions_id_fk` FOREIGN KEY (`region_id`) REFERENCES `regions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff_user_roles` ADD CONSTRAINT `staff_user_roles_staff_user_id_staff_users_id_fk` FOREIGN KEY (`staff_user_id`) REFERENCES `staff_users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff_user_roles` ADD CONSTRAINT `staff_user_roles_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff_user_roles` ADD CONSTRAINT `staff_user_roles_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tracking_sessions` ADD CONSTRAINT `tracking_sessions_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wallet_topups` ADD CONSTRAINT `wallet_topups_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wallet_transactions` ADD CONSTRAINT `wallet_transactions_wallet_id_barber_wallets_id_fk` FOREIGN KEY (`wallet_id`) REFERENCES `barber_wallets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `withdrawals` ADD CONSTRAINT `withdrawals_barber_id_barbers_id_fk` FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admin_notification_settings` ADD CONSTRAINT `admin_notification_settings_staff_user_id_staff_users_id_fk` FOREIGN KEY (`staff_user_id`) REFERENCES `staff_users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `appointment_events_appointment_created_idx` ON `appointment_events` (`appointment_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `appointments_fulfillment_status` ON `appointments` (`fulfillment_type`,`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `idx_appointments_barber_status` ON `appointments` (`barber_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_appointments_branch_status_date` ON `appointments` (`branch_id`,`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `appointments_customer_status_schedule` ON `appointments` (`customer_id`,`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_branch_id` ON `audit_logs` (`branch_id`);--> statement-breakpoint
CREATE INDEX `auth_events_created_at_idx` ON `auth_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `auth_events_identifier_idx` ON `auth_events` (`identifier_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `auth_sessions_user_active_idx` ON `auth_sessions` (`user_type`,`user_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `barber_open_orders_barber_date_idx` ON `barber_open_orders` (`barber_id`,`order_date`);--> statement-breakpoint
CREATE INDEX `barber_open_orders_lookup_idx` ON `barber_open_orders` (`branch_id`,`order_date`,`start_time`);--> statement-breakpoint
CREATE INDEX `idx_barber_portfolios_barber_created_at` ON `barber_portfolios` (`barber_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `barber_time_off_barber_range_idx` ON `barber_time_off` (`barber_id`,`start_at`,`end_at`);--> statement-breakpoint
CREATE INDEX `idx_barbers_approval_status` ON `barbers` (`approval_status`);--> statement-breakpoint
CREATE INDEX `idx_chat_messages_appointment_created` ON `chat_messages` (`appointment_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_commission_entries_appointment` ON `commission_entries` (`appointment_id`);--> statement-breakpoint
CREATE INDEX `idx_customer_addresses_customer_id` ON `customer_addresses` (`customer_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_customer_wallet_transactions_wallet_id` ON `customer_wallet_transactions` (`wallet_id`);--> statement-breakpoint
CREATE INDEX `idx_customer_wallets_customer_id` ON `customer_wallets` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_customer_withdrawals_customer_id` ON `customer_withdrawals` (`customer_id`);--> statement-breakpoint
CREATE INDEX `media_assets_owner_idx` ON `media_assets` (`owner_type`,`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_notifications_recipient_unread` ON `notifications` (`recipient_type`,`recipient_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_payments_gateway_reference` ON `payments` (`gateway_reference`);--> statement-breakpoint
CREATE INDEX `idx_payments_branch_paid_at` ON `payments` (`branch_id`,`paid_at`);--> statement-breakpoint
CREATE INDEX `idx_promotions_active_window` ON `promotions` (`is_active`,`starts_at`,`ends_at`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_service_prices_resolver` ON `service_prices` (`service_id`,`branch_id`,`effective_from`);--> statement-breakpoint
CREATE INDEX `idx_staff_user_roles_staff_branch` ON `staff_user_roles` (`staff_user_id`,`branch_id`);--> statement-breakpoint
CREATE INDEX `tracking_sessions_appointment_status_expires` ON `tracking_sessions` (`appointment_id`,`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `tracking_sessions_one_active_per_appointment` ON `tracking_sessions` (`appointment_id`);--> statement-breakpoint
CREATE INDEX `idx_wallet_topups_customer_id` ON `wallet_topups` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_wallet_topups_gateway_reference` ON `wallet_topups` (`gateway_reference`);--> statement-breakpoint
CREATE INDEX `idx_wallet_transactions_wallet_id` ON `wallet_transactions` (`wallet_id`);