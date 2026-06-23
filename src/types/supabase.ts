export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      appointment_products: {
        Row: {
          appointment_id: string
          created_at: string | null
          id: string
          product_id: string
          quantity: number
          unit_price: number
        }
        Insert: {
          appointment_id: string
          created_at?: string | null
          id?: string
          product_id: string
          quantity: number
          unit_price: number
        }
        Update: {
          appointment_id?: string
          created_at?: string | null
          id?: string
          product_id?: string
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "appointment_products_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_services: {
        Row: {
          appointment_id: string
          created_at: string | null
          duration_min: number
          id: string
          price_amount: number
          service_id: string
        }
        Insert: {
          appointment_id: string
          created_at?: string | null
          duration_min: number
          id?: string
          price_amount: number
          service_id: string
        }
        Update: {
          appointment_id?: string
          created_at?: string | null
          duration_min?: number
          id?: string
          price_amount?: number
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_services_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_events: {
        Row: {
          actor_id: string | null
          actor_role: string | null
          actor_type: string
          appointment_id: string
          created_at: string
          event_type: string
          from_status: string | null
          id: string
          metadata: Json | null
          reason: string
          to_status: string
        }
        Insert: {
          actor_id?: string | null
          actor_role?: string | null
          actor_type: string
          appointment_id: string
          created_at?: string
          event_type: string
          from_status?: string | null
          id?: string
          metadata?: Json | null
          reason: string
          to_status: string
        }
        Update: {
          actor_id?: string | null
          actor_role?: string | null
          actor_type?: string
          appointment_id?: string
          created_at?: string
          event_type?: string
          from_status?: string | null
          id?: string
          metadata?: Json | null
          reason?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_events_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          barber_id: string | null
          branch_id: string
          cancellation_reason: string | null
          checked_in_at: string | null
          completed_at: string | null
          created_at: string | null
          customer_id: string | null
          customer_media_urls: Json
          destination_latitude: number | null
          destination_longitude: number | null
          fulfillment_type: string
          id: string
          idempotency_key: string | null
          journey_status: string
          location_notes: string | null
          queue_position: number | null
          schedule_block_end_at: string | null
          schedule_block_start_at: string | null
          scheduled_at: string | null
          scheduled_end_at: string | null
          service_address: string | null
          source: string
          started_at: string | null
          status: string
          travel_buffer_min: number
          updated_at: string | null
          version: number
        }
        Insert: {
          barber_id?: string | null
          branch_id: string
          cancellation_reason?: string | null
          checked_in_at?: string | null
          completed_at?: string | null
          created_at?: string | null
          customer_id?: string | null
          customer_media_urls?: Json
          destination_latitude?: number | null
          destination_longitude?: number | null
          fulfillment_type?: string
          id?: string
          idempotency_key?: string | null
          journey_status?: string
          location_notes?: string | null
          queue_position?: number | null
          schedule_block_end_at?: string | null
          schedule_block_start_at?: string | null
          scheduled_at?: string | null
          scheduled_end_at?: string | null
          service_address?: string | null
          source: string
          started_at?: string | null
          status: string
          travel_buffer_min?: number
          updated_at?: string | null
          version?: number
        }
        Update: {
          barber_id?: string | null
          branch_id?: string
          cancellation_reason?: string | null
          checked_in_at?: string | null
          completed_at?: string | null
          created_at?: string | null
          customer_id?: string | null
          customer_media_urls?: Json
          destination_latitude?: number | null
          destination_longitude?: number | null
          fulfillment_type?: string
          id?: string
          idempotency_key?: string | null
          journey_status?: string
          location_notes?: string | null
          queue_position?: number | null
          schedule_block_end_at?: string | null
          schedule_block_start_at?: string | null
          scheduled_at?: string | null
          scheduled_end_at?: string | null
          service_address?: string | null
          source?: string
          started_at?: string | null
          status?: string
          travel_buffer_min?: number
          updated_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "appointments_barber_id_fkey"
            columns: ["barber_id"]
            isOneToOne: false
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string
          actor_type: string
          after: Json | null
          before: Json | null
          branch_id: string | null
          created_at: string | null
          entity_id: string
          entity_type: string
          id: string
        }
        Insert: {
          action: string
          actor_id: string
          actor_type: string
          after?: Json | null
          before?: Json | null
          branch_id?: string | null
          created_at?: string | null
          entity_id: string
          entity_type: string
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string
          actor_type?: string
          after?: Json | null
          before?: Json | null
          branch_id?: string | null
          created_at?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
        }
        Relationships: []
      }
      auth_events: {
        Row: {
          created_at: string | null
          event_type: string
          id: string
          identifier_hash: string | null
          ip_hash: string | null
          metadata: Json | null
          success: boolean
          user_id: string | null
          user_type: string
        }
        Insert: {
          created_at?: string | null
          event_type: string
          id?: string
          identifier_hash?: string | null
          ip_hash?: string | null
          metadata?: Json | null
          success: boolean
          user_id?: string | null
          user_type: string
        }
        Update: {
          created_at?: string | null
          event_type?: string
          id?: string
          identifier_hash?: string | null
          ip_hash?: string | null
          metadata?: Json | null
          success?: boolean
          user_id?: string | null
          user_type?: string
        }
        Relationships: []
      }
      auth_sessions: {
        Row: {
          created_at: string | null
          expires_at: string
          id: string
          ip_hash: string | null
          last_used_at: string
          refresh_jti_hash: string
          revoke_reason: string | null
          revoked_at: string | null
          updated_at: string | null
          user_agent: string | null
          user_id: string
          user_type: string
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          id?: string
          ip_hash?: string | null
          last_used_at?: string
          refresh_jti_hash: string
          revoke_reason?: string | null
          revoked_at?: string | null
          updated_at?: string | null
          user_agent?: string | null
          user_id: string
          user_type: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: string
          ip_hash?: string | null
          last_used_at?: string
          refresh_jti_hash?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          updated_at?: string | null
          user_agent?: string | null
          user_id?: string
          user_type?: string
        }
        Relationships: []
      }
      barber_daily_stats: {
        Row: {
          avg_rating: number | null
          barber_id: string
          branch_id: string
          commission_earned: number | null
          created_at: string | null
          heads_count: number | null
          id: string
          revenue: number | null
          summary_date: string
          updated_at: string | null
        }
        Insert: {
          avg_rating?: number | null
          barber_id: string
          branch_id: string
          commission_earned?: number | null
          created_at?: string | null
          heads_count?: number | null
          id?: string
          revenue?: number | null
          summary_date: string
          updated_at?: string | null
        }
        Update: {
          avg_rating?: number | null
          barber_id?: string
          branch_id?: string
          commission_earned?: number | null
          created_at?: string | null
          heads_count?: number | null
          id?: string
          revenue?: number | null
          summary_date?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "barber_daily_stats_barber_id_fkey"
            columns: ["barber_id"]
            isOneToOne: false
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barber_daily_stats_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      barber_payouts: {
        Row: {
          barber_id: string
          created_at: string | null
          id: string
          paid_at: string | null
          period_end: string
          period_start: string
          status: string
          total_amount: number
          updated_at: string | null
        }
        Insert: {
          barber_id: string
          created_at?: string | null
          id?: string
          paid_at?: string | null
          period_end: string
          period_start: string
          status: string
          total_amount: number
          updated_at?: string | null
        }
        Update: {
          barber_id?: string
          created_at?: string | null
          id?: string
          paid_at?: string | null
          period_end?: string
          period_start?: string
          status?: string
          total_amount?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "barber_payouts_barber_id_fkey"
            columns: ["barber_id"]
            isOneToOne: false
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
        ]
      }
      barber_portfolios: {
        Row: {
          barber_id: string
          caption: string | null
          created_at: string | null
          id: string
          image_url: string
        }
        Insert: {
          barber_id: string
          caption?: string | null
          created_at?: string | null
          id?: string
          image_url: string
        }
        Update: {
          barber_id?: string
          caption?: string | null
          created_at?: string | null
          id?: string
          image_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "barber_portfolios_barber_id_fkey"
            columns: ["barber_id"]
            isOneToOne: false
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
        ]
      }
      barber_shifts: {
        Row: {
          barber_id: string
          branch_id: string
          created_at: string | null
          end_time: string
          id: string
          shift_date: string
          start_time: string
          updated_at: string | null
        }
        Insert: {
          barber_id: string
          branch_id: string
          created_at?: string | null
          end_time: string
          id?: string
          shift_date: string
          start_time: string
          updated_at?: string | null
        }
        Update: {
          barber_id?: string
          branch_id?: string
          created_at?: string | null
          end_time?: string
          id?: string
          shift_date?: string
          start_time?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "barber_shifts_barber_id_fkey"
            columns: ["barber_id"]
            isOneToOne: false
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barber_shifts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      barber_status_log: {
        Row: {
          barber_id: string
          created_at: string | null
          id: string
          status: string
        }
        Insert: {
          barber_id: string
          created_at?: string | null
          id?: string
          status: string
        }
        Update: {
          barber_id?: string
          created_at?: string | null
          id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "barber_status_log_barber_id_fkey"
            columns: ["barber_id"]
            isOneToOne: false
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
        ]
      }
      barber_time_off: {
        Row: {
          barber_id: string
          created_at: string | null
          end_at: string
          id: string
          reason: string | null
          start_at: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          barber_id: string
          created_at?: string | null
          end_at: string
          id?: string
          reason?: string | null
          start_at: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          barber_id?: string
          created_at?: string | null
          end_at?: string
          id?: string
          reason?: string | null
          start_at?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "barber_time_off_barber_id_fkey"
            columns: ["barber_id"]
            isOneToOne: false
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
        ]
      }
      barbers: {
        Row: {
          bio: string | null
          branch_id: string
          created_at: string | null
          default_commission_rule_id: string | null
          deleted_at: string | null
          display_name: string
          id: string
          live_status: string | null
          rating_avg: number | null
          rating_count: number | null
          service_radius_km: number
          staff_user_id: string
          updated_at: string | null
        }
        Insert: {
          bio?: string | null
          branch_id: string
          created_at?: string | null
          default_commission_rule_id?: string | null
          deleted_at?: string | null
          display_name: string
          id?: string
          live_status?: string | null
          rating_avg?: number | null
          rating_count?: number | null
          service_radius_km?: number
          staff_user_id: string
          updated_at?: string | null
        }
        Update: {
          bio?: string | null
          branch_id?: string
          created_at?: string | null
          default_commission_rule_id?: string | null
          deleted_at?: string | null
          display_name?: string
          id?: string
          live_status?: string | null
          rating_avg?: number | null
          rating_count?: number | null
          service_radius_km?: number
          staff_user_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "barbers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barbers_staff_user_id_fkey"
            columns: ["staff_user_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_barbers_commission_rule"
            columns: ["default_commission_rule_id"]
            isOneToOne: false
            referencedRelation: "commission_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_expenses: {
        Row: {
          amount: number
          branch_id: string
          category: string
          created_at: string | null
          id: string
          note: string | null
          recorded_by: string
          spent_at: string
        }
        Insert: {
          amount: number
          branch_id: string
          category: string
          created_at?: string | null
          id?: string
          note?: string | null
          recorded_by: string
          spent_at: string
        }
        Update: {
          amount?: number
          branch_id?: string
          category?: string
          created_at?: string | null
          id?: string
          note?: string | null
          recorded_by?: string
          spent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_expenses_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_expenses_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_inventory: {
        Row: {
          branch_id: string
          created_at: string | null
          id: string
          product_id: string
          quantity_on_hand: number | null
          reorder_level: number | null
          updated_at: string | null
        }
        Insert: {
          branch_id: string
          created_at?: string | null
          id?: string
          product_id: string
          quantity_on_hand?: number | null
          reorder_level?: number | null
          updated_at?: string | null
        }
        Update: {
          branch_id?: string
          created_at?: string | null
          id?: string
          product_id?: string
          quantity_on_hand?: number | null
          reorder_level?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "branch_inventory_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_operating_hours: {
        Row: {
          branch_id: string
          close_time: string
          created_at: string | null
          day_of_week: number
          id: string
          open_time: string
          updated_at: string | null
        }
        Insert: {
          branch_id: string
          close_time: string
          created_at?: string | null
          day_of_week: number
          id?: string
          open_time: string
          updated_at?: string | null
        }
        Update: {
          branch_id?: string
          close_time?: string
          created_at?: string | null
          day_of_week?: number
          id?: string
          open_time?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "branch_operating_hours_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_photos: {
        Row: {
          branch_id: string
          created_at: string | null
          id: string
          sort_order: number | null
          url: string
        }
        Insert: {
          branch_id: string
          created_at?: string | null
          id?: string
          sort_order?: number | null
          url: string
        }
        Update: {
          branch_id?: string
          created_at?: string | null
          id?: string
          sort_order?: number | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_photos_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          address: string | null
          created_at: string | null
          deleted_at: string | null
          geog: unknown
          id: string
          is_active: boolean | null
          latitude: number | null
          longitude: number | null
          name: string
          phone: string | null
          region_id: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string | null
          deleted_at?: string | null
          geog?: unknown
          id?: string
          is_active?: boolean | null
          latitude?: number | null
          longitude?: number | null
          name: string
          phone?: string | null
          region_id?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string | null
          deleted_at?: string | null
          geog?: unknown
          id?: string
          is_active?: boolean | null
          latitude?: number | null
          longitude?: number | null
          name?: string
          phone?: string | null
          region_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "branches_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_drawer_sessions: {
        Row: {
          branch_id: string
          closed_at: string | null
          closing_balance: number | null
          created_at: string | null
          id: string
          opened_at: string
          opened_by: string
          opening_balance: number
          updated_at: string | null
        }
        Insert: {
          branch_id: string
          closed_at?: string | null
          closing_balance?: number | null
          created_at?: string | null
          id?: string
          opened_at: string
          opened_by: string
          opening_balance: number
          updated_at?: string | null
        }
        Update: {
          branch_id?: string
          closed_at?: string | null
          closing_balance?: number | null
          created_at?: string | null
          id?: string
          opened_at?: string
          opened_by?: string
          opening_balance?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_drawer_sessions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_drawer_sessions_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
        ]
      }
      check_ins: {
        Row: {
          appointment_id: string
          checked_in_at: string
          created_at: string | null
          id: string
          latitude: number | null
          longitude: number | null
          method: string
        }
        Insert: {
          appointment_id: string
          checked_in_at: string
          created_at?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          method: string
        }
        Update: {
          appointment_id?: string
          checked_in_at?: string
          created_at?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          method?: string
        }
        Relationships: [
          {
            foreignKeyName: "check_ins_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_entries: {
        Row: {
          appointment_id: string
          barber_share: number
          base_amount: number
          branch_share: number
          calculated_at: string
          commission_rule_id: string
          created_at: string | null
          hq_share: number
          id: string
          tip_amount: number | null
        }
        Insert: {
          appointment_id: string
          barber_share: number
          base_amount: number
          branch_share: number
          calculated_at: string
          commission_rule_id: string
          created_at?: string | null
          hq_share: number
          id?: string
          tip_amount?: number | null
        }
        Update: {
          appointment_id?: string
          barber_share?: number
          base_amount?: number
          branch_share?: number
          calculated_at?: string
          commission_rule_id?: string
          created_at?: string | null
          hq_share?: number
          id?: string
          tip_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "commission_entries_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: true
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_entries_commission_rule_id_fkey"
            columns: ["commission_rule_id"]
            isOneToOne: false
            referencedRelation: "commission_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_rules: {
        Row: {
          barber_pct: number
          branch_pct: number
          created_at: string | null
          effective_from: string
          effective_to: string | null
          hq_pct: number
          id: string
          scope: string
          scope_ref_id: string | null
          tip_to_barber: boolean | null
          updated_at: string | null
        }
        Insert: {
          barber_pct: number
          branch_pct: number
          created_at?: string | null
          effective_from: string
          effective_to?: string | null
          hq_pct: number
          id?: string
          scope: string
          scope_ref_id?: string | null
          tip_to_barber?: boolean | null
          updated_at?: string | null
        }
        Update: {
          barber_pct?: number
          branch_pct?: number
          created_at?: string | null
          effective_from?: string
          effective_to?: string | null
          hq_pct?: number
          id?: string
          scope?: string
          scope_ref_id?: string | null
          tip_to_barber?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      customers: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          email: string | null
          full_name: string
          id: string
          is_active: boolean | null
          password_hash: string | null
          phone: string
          points_balance: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          full_name: string
          id?: string
          is_active?: boolean | null
          password_hash?: string | null
          phone: string
          points_balance?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean | null
          password_hash?: string | null
          phone?: string
          points_balance?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      daily_branch_summaries: {
        Row: {
          booking_count: number | null
          branch_id: string
          branch_share_total: number | null
          created_at: string | null
          hq_share_total: number | null
          id: string
          no_show_count: number | null
          summary_date: string
          total_appointments: number | null
          total_revenue: number | null
          updated_at: string | null
          walk_in_count: number | null
        }
        Insert: {
          booking_count?: number | null
          branch_id: string
          branch_share_total?: number | null
          created_at?: string | null
          hq_share_total?: number | null
          id?: string
          no_show_count?: number | null
          summary_date: string
          total_appointments?: number | null
          total_revenue?: number | null
          updated_at?: string | null
          walk_in_count?: number | null
        }
        Update: {
          booking_count?: number | null
          branch_id?: string
          branch_share_total?: number | null
          created_at?: string | null
          hq_share_total?: number | null
          id?: string
          no_show_count?: number | null
          summary_date?: string
          total_appointments?: number | null
          total_revenue?: number | null
          updated_at?: string | null
          walk_in_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_branch_summaries_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          branch_id: string
          created_at: string | null
          id: string
          note: string | null
          product_id: string
          quantity: number
          reference_id: string | null
          type: string
        }
        Insert: {
          branch_id: string
          created_at?: string | null
          id?: string
          note?: string | null
          product_id: string
          quantity: number
          reference_id?: string | null
          type: string
        }
        Update: {
          branch_id?: string
          created_at?: string | null
          id?: string
          note?: string | null
          product_id?: string
          quantity?: number
          reference_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string | null
          id: string
          invoice_number: string
          issued_at: string
          payment_id: string
          pdf_url: string | null
          public_access_expires_at: string | null
          public_access_token_hash: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          invoice_number: string
          issued_at: string
          payment_id: string
          pdf_url?: string | null
          public_access_expires_at?: string | null
          public_access_token_hash?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          invoice_number?: string
          issued_at?: string
          payment_id?: string
          pdf_url?: string | null
          public_access_expires_at?: string | null
          public_access_token_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_transactions: {
        Row: {
          created_at: string | null
          customer_id: string
          id: string
          note: string | null
          points: number
          reference_id: string | null
          type: string
        }
        Insert: {
          created_at?: string | null
          customer_id: string
          id?: string
          note?: string | null
          points: number
          reference_id?: string | null
          type: string
        }
        Update: {
          created_at?: string | null
          customer_id?: string
          id?: string
          note?: string | null
          points?: number
          reference_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_campaigns: {
        Row: {
          audience: Json | null
          body: string
          created_at: string | null
          id: string
          scheduled_at: string | null
          sent_at: string | null
          status: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          audience?: Json | null
          body: string
          created_at?: string | null
          id?: string
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          audience?: Json | null
          body?: string
          created_at?: string | null
          id?: string
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      media_assets: {
        Row: {
          bucket: string
          content_type: string
          created_at: string | null
          deleted_at: string | null
          height: number | null
          id: string
          object_path: string
          owner_id: string
          owner_type: string
          purpose: string
          size_bytes: number
          updated_at: string | null
          visibility: string
          width: number | null
        }
        Insert: {
          bucket: string
          content_type: string
          created_at?: string | null
          deleted_at?: string | null
          height?: number | null
          id?: string
          object_path: string
          owner_id: string
          owner_type: string
          purpose: string
          size_bytes: number
          updated_at?: string | null
          visibility?: string
          width?: number | null
        }
        Update: {
          bucket?: string
          content_type?: string
          created_at?: string | null
          deleted_at?: string | null
          height?: number | null
          id?: string
          object_path?: string
          owner_id?: string
          owner_type?: string
          purpose?: string
          size_bytes?: number
          updated_at?: string | null
          visibility?: string
          width?: number | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          created_at: string | null
          id: string
          read_at: string | null
          recipient_id: string
          recipient_type: string
          sent_at: string | null
          title: string
          type: string
        }
        Insert: {
          body: string
          created_at?: string | null
          id?: string
          read_at?: string | null
          recipient_id: string
          recipient_type: string
          sent_at?: string | null
          title: string
          type: string
        }
        Update: {
          body?: string
          created_at?: string | null
          id?: string
          read_at?: string | null
          recipient_id?: string
          recipient_type?: string
          sent_at?: string | null
          title?: string
          type?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          appointment_id: string
          created_at: string | null
          discount_amount: number | null
          gateway_reference: string | null
          id: string
          method: string
          paid_at: string | null
          product_amount: number
          service_amount: number
          status: string
          tip_amount: number | null
          total_amount: number
          updated_at: string | null
        }
        Insert: {
          appointment_id: string
          created_at?: string | null
          discount_amount?: number | null
          gateway_reference?: string | null
          id?: string
          method: string
          paid_at?: string | null
          product_amount: number
          service_amount: number
          status: string
          tip_amount?: number | null
          total_amount: number
          updated_at?: string | null
        }
        Update: {
          appointment_id?: string
          created_at?: string | null
          discount_amount?: number | null
          gateway_reference?: string | null
          id?: string
          method?: string
          paid_at?: string | null
          product_amount?: number
          service_amount?: number
          status?: string
          tip_amount?: number | null
          total_amount?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: true
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          code: string
          created_at: string | null
          id: string
        }
        Insert: {
          code: string
          created_at?: string | null
          id?: string
        }
        Update: {
          code?: string
          created_at?: string | null
          id?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          base_price: number
          created_at: string | null
          deleted_at: string | null
          description: string | null
          id: string
          name: string
          sku: string
          updated_at: string | null
        }
        Insert: {
          base_price: number
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          name: string
          sku: string
          updated_at?: string | null
        }
        Update: {
          base_price?: number
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          name?: string
          sku?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      promotions: {
        Row: {
          created_at: string | null
          ends_at: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          starts_at: string | null
          target_url: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          ends_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          starts_at?: string | null
          target_url?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          ends_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          starts_at?: string | null
          target_url?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      refunds: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          payment_id: string
          processed_at: string
          processed_by: string | null
          reason: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: string
          payment_id: string
          processed_at: string
          processed_by?: string | null
          reason: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          payment_id?: string
          processed_at?: string
          processed_by?: string | null
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_processed_by_fkey"
            columns: ["processed_by"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
        ]
      }
      regions: {
        Row: {
          code: string
          created_at: string | null
          deleted_at: string | null
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      reviews: {
        Row: {
          appointment_id: string
          barber_id: string
          branch_id: string
          comment: string | null
          created_at: string | null
          customer_id: string
          id: string
          photo_url: string | null
          rating: number
          updated_at: string | null
        }
        Insert: {
          appointment_id: string
          barber_id: string
          branch_id: string
          comment?: string | null
          created_at?: string | null
          customer_id: string
          id?: string
          photo_url?: string | null
          rating: number
          updated_at?: string | null
        }
        Update: {
          appointment_id?: string
          barber_id?: string
          branch_id?: string
          comment?: string | null
          created_at?: string | null
          customer_id?: string
          id?: string
          photo_url?: string | null
          rating?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: true
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_barber_id_fkey"
            columns: ["barber_id"]
            isOneToOne: false
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          created_at: string | null
          id: string
          permission_id: string
          role_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          permission_id: string
          role_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      service_prices: {
        Row: {
          branch_id: string | null
          created_at: string | null
          effective_from: string
          effective_to: string | null
          id: string
          price_amount: number
          region_id: string | null
          service_id: string
          updated_at: string | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string | null
          effective_from: string
          effective_to?: string | null
          id?: string
          price_amount: number
          region_id?: string | null
          service_id: string
          updated_at?: string | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          price_amount?: number
          region_id?: string | null
          service_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_prices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_prices_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_prices_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          created_at: string | null
          default_duration_min: number
          deleted_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          default_duration_min: number
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          default_duration_min?: number
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
        }
        Relationships: []
      }
      staff_user_roles: {
        Row: {
          branch_id: string | null
          created_at: string | null
          id: string
          role_id: string
          staff_user_id: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string | null
          id?: string
          role_id: string
          staff_user_id: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string | null
          id?: string
          role_id?: string
          staff_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_user_roles_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_user_roles_staff_user_id_fkey"
            columns: ["staff_user_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_users: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          email: string
          full_name: string
          id: string
          is_active: boolean | null
          password_hash: string | null
          phone: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          email: string
          full_name: string
          id?: string
          is_active?: boolean | null
          password_hash?: string | null
          phone?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean | null
          password_hash?: string | null
          phone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      tracking_sessions: {
        Row: {
          appointment_id: string
          consent_given_at: string
          created_at: string
          ended_at: string | null
          ended_reason: string | null
          expires_at: string
          id: string
          last_activity_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          appointment_id: string
          consent_given_at: string
          created_at?: string
          ended_at?: string | null
          ended_reason?: string | null
          expires_at: string
          id?: string
          last_activity_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          consent_given_at?: string
          created_at?: string
          ended_at?: string | null
          ended_reason?: string | null
          expires_at?: string
          id?: string
          last_activity_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracking_sessions_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_redemptions: {
        Row: {
          appointment_id: string
          created_at: string | null
          customer_id: string
          id: string
          redeemed_at: string | null
          voucher_id: string
        }
        Insert: {
          appointment_id: string
          created_at?: string | null
          customer_id: string
          id?: string
          redeemed_at?: string | null
          voucher_id: string
        }
        Update: {
          appointment_id?: string
          created_at?: string | null
          customer_id?: string
          id?: string
          redeemed_at?: string | null
          voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voucher_redemptions_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_redemptions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_redemptions_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      vouchers: {
        Row: {
          branch_scope: string | null
          code: string
          created_at: string | null
          id: string
          max_uses: number | null
          min_spend: number | null
          per_customer_limit: number | null
          type: string
          updated_at: string | null
          used_count: number | null
          valid_from: string
          valid_until: string
          value: number
        }
        Insert: {
          branch_scope?: string | null
          code: string
          created_at?: string | null
          id?: string
          max_uses?: number | null
          min_spend?: number | null
          per_customer_limit?: number | null
          type: string
          updated_at?: string | null
          used_count?: number | null
          valid_from: string
          valid_until: string
          value: number
        }
        Update: {
          branch_scope?: string | null
          code?: string
          created_at?: string | null
          id?: string
          max_uses?: number | null
          min_spend?: number | null
          per_customer_limit?: number | null
          type?: string
          updated_at?: string | null
          used_count?: number | null
          valid_from?: string
          valid_until?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "vouchers_branch_scope_fkey"
            columns: ["branch_scope"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      create_appointment_atomic: {
        Args: {
          p_actor_id: string
          p_actor_type: string
          p_barber_id: string | null
          p_branch_id: string
          p_customer_id: string | null
          p_customer_media_urls?: Json
          p_destination_latitude?: number | null
          p_destination_longitude?: number | null
          p_fulfillment_type?: string
          p_idempotency_key: string
          p_location_notes?: string | null
          p_scheduled_at: string
          p_service_address?: string | null
          p_service_ids: string[]
          p_source: string
          p_travel_buffer_min?: number
        }
        Returns: Database["public"]["Tables"]["appointments"]["Row"]
      }
      transition_appointment_status_atomic: {
        Args: {
          p_actor_id: string | null
          p_actor_role: string
          p_actor_type: string
          p_appointment_id: string
          p_customer_media_urls?: Json | null
          p_event_type?: string
          p_expected_version: number
          p_reason: string
          p_target_status: string
        }
        Returns: Database["public"]["Tables"]["appointments"]["Row"]
      }
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      disablelongtransactions: { Args: never; Returns: string }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      enablelongtransactions: { Args: never; Returns: string }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      gettransactionid: { Args: never; Returns: unknown }
      longtransactionsenabled: { Args: never; Returns: boolean }
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      unlockrows: { Args: { "": string }; Returns: number }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
