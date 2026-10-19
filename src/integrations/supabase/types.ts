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
      audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          diff: Json
          id: string
          request_id: string | null
          target_id: string | null
          target_table: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          diff?: Json
          id?: string
          request_id?: string | null
          target_id?: string | null
          target_table?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          diff?: Json
          id?: string
          request_id?: string | null
          target_id?: string | null
          target_table?: string | null
        }
        Relationships: []
      }
      billing_customers: {
        Row: {
          created_at: string
          email: string | null
          id: string
          provider: string
          stripe_account_id: string
          stripe_customer_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          provider?: string
          stripe_account_id: string
          stripe_customer_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          provider?: string
          stripe_account_id?: string
          stripe_customer_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      business_credentials: {
        Row: {
          business_id: string
          created_at: string
          credential_type: string
          document_path: string | null
          expires_at: string | null
          id: string
          identifier: string | null
          issued_at: string | null
          issuing_authority: string | null
          private_notes: string | null
          public_display_approved: boolean
          review_status: Database["public"]["Enums"]["credential_review_status"]
          reviewed_at: string | null
          reviewed_by: string | null
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          credential_type: string
          document_path?: string | null
          expires_at?: string | null
          id?: string
          identifier?: string | null
          issued_at?: string | null
          issuing_authority?: string | null
          private_notes?: string | null
          public_display_approved?: boolean
          review_status?: Database["public"]["Enums"]["credential_review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          credential_type?: string
          document_path?: string | null
          expires_at?: string | null
          id?: string
          identifier?: string | null
          issued_at?: string | null
          issuing_authority?: string | null
          private_notes?: string | null
          public_display_approved?: boolean
          review_status?: Database["public"]["Enums"]["credential_review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_credentials_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_follows: {
        Row: {
          business_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_follows_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_members: {
        Row: {
          business_id: string
          created_at: string
          id: string
          invitation_status: Database["public"]["Enums"]["invitation_status"]
          invited_by: string | null
          joined_at: string | null
          membership_role: Database["public"]["Enums"]["membership_role"]
          permissions: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          invitation_status?: Database["public"]["Enums"]["invitation_status"]
          invited_by?: string | null
          joined_at?: string | null
          membership_role?: Database["public"]["Enums"]["membership_role"]
          permissions?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          invitation_status?: Database["public"]["Enums"]["invitation_status"]
          invited_by?: string | null
          joined_at?: string | null
          membership_role?: Database["public"]["Enums"]["membership_role"]
          permissions?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_members_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_policies: {
        Row: {
          business_id: string
          content: string
          created_at: string
          created_by: string | null
          id: string
          is_published: boolean
          policy_type: string
          slug: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          business_id: string
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_published?: boolean
          policy_type?: string
          slug: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_published?: boolean
          policy_type?: string
          slug?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_policies_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          address_city: string | null
          address_country: string | null
          address_state: string | null
          cover_path: string | null
          created_at: string
          created_by: string | null
          description: string | null
          display_name: string
          employee_count_range: string | null
          entity_type: string | null
          formation_state: string | null
          handle: string | null
          headline: string | null
          id: string
          legal_name: string
          logo_path: string | null
          primary_industry: string | null
          profile_status: Database["public"]["Enums"]["profile_status"]
          public_email: string | null
          public_phone: string | null
          public_profile_enabled: boolean
          published_at: string | null
          service_areas: string[]
          slug: string
          tax_id_last4: string | null
          updated_at: string
          verification_checked_at: string | null
          verification_failure_reason: string | null
          verification_reference: string | null
          verification_status: Database["public"]["Enums"]["verification_status"]
          website_url: string | null
          year_founded: number | null
        }
        Insert: {
          address_city?: string | null
          address_country?: string | null
          address_state?: string | null
          cover_path?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_name: string
          employee_count_range?: string | null
          entity_type?: string | null
          formation_state?: string | null
          handle?: string | null
          headline?: string | null
          id?: string
          legal_name: string
          logo_path?: string | null
          primary_industry?: string | null
          profile_status?: Database["public"]["Enums"]["profile_status"]
          public_email?: string | null
          public_phone?: string | null
          public_profile_enabled?: boolean
          published_at?: string | null
          service_areas?: string[]
          slug: string
          tax_id_last4?: string | null
          updated_at?: string
          verification_checked_at?: string | null
          verification_failure_reason?: string | null
          verification_reference?: string | null
          verification_status?: Database["public"]["Enums"]["verification_status"]
          website_url?: string | null
          year_founded?: number | null
        }
        Update: {
          address_city?: string | null
          address_country?: string | null
          address_state?: string | null
          cover_path?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_name?: string
          employee_count_range?: string | null
          entity_type?: string | null
          formation_state?: string | null
          handle?: string | null
          headline?: string | null
          id?: string
          legal_name?: string
          logo_path?: string | null
          primary_industry?: string | null
          profile_status?: Database["public"]["Enums"]["profile_status"]
          public_email?: string | null
          public_phone?: string | null
          public_profile_enabled?: boolean
          published_at?: string | null
          service_areas?: string[]
          slug?: string
          tax_id_last4?: string | null
          updated_at?: string
          verification_checked_at?: string | null
          verification_failure_reason?: string | null
          verification_reference?: string | null
          verification_status?: Database["public"]["Enums"]["verification_status"]
          website_url?: string | null
          year_founded?: number | null
        }
        Relationships: []
      }
      capital_products: {
        Row: {
          closing_days: number | null
          created_at: string
          id: string
          lender_id: string
          max_loan_amount: number
          min_loan_amount: number
          negotiable: boolean
          points_max_bps: number | null
          points_min_bps: number | null
          product_types: Json
          rate_max_bps: number
          rate_min_bps: number
          term_max_months: number | null
          term_min_months: number | null
        }
        Insert: {
          closing_days?: number | null
          created_at?: string
          id?: string
          lender_id: string
          max_loan_amount: number
          min_loan_amount: number
          negotiable?: boolean
          points_max_bps?: number | null
          points_min_bps?: number | null
          product_types: Json
          rate_max_bps: number
          rate_min_bps: number
          term_max_months?: number | null
          term_min_months?: number | null
        }
        Update: {
          closing_days?: number | null
          created_at?: string
          id?: string
          lender_id?: string
          max_loan_amount?: number
          min_loan_amount?: number
          negotiable?: boolean
          points_max_bps?: number | null
          points_min_bps?: number | null
          product_types?: Json
          rate_max_bps?: number
          rate_min_bps?: number
          term_max_months?: number | null
          term_min_months?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "capital_products_lender_id_fkey"
            columns: ["lender_id"]
            isOneToOne: false
            referencedRelation: "lender_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          author_avatar_url: string | null
          author_badge: Database["public"]["Enums"]["chat_badge"] | null
          author_display_name: string | null
          body: string
          content_sha256: string | null
          created_at: string
          event_id: string
          external_id: string | null
          id: string
          is_hidden: boolean
          kind: string
          metadata: Json
          moderation_status: Database["public"]["Enums"]["moderation_status"]
          published_at: string | null
          source: Database["public"]["Enums"]["chat_source"]
          source_created_at: string | null
          user_id: string | null
        }
        Insert: {
          author_avatar_url?: string | null
          author_badge?: Database["public"]["Enums"]["chat_badge"] | null
          author_display_name?: string | null
          body: string
          content_sha256?: string | null
          created_at?: string
          event_id: string
          external_id?: string | null
          id?: string
          is_hidden?: boolean
          kind?: string
          metadata?: Json
          moderation_status?: Database["public"]["Enums"]["moderation_status"]
          published_at?: string | null
          source?: Database["public"]["Enums"]["chat_source"]
          source_created_at?: string | null
          user_id?: string | null
        }
        Update: {
          author_avatar_url?: string | null
          author_badge?: Database["public"]["Enums"]["chat_badge"] | null
          author_display_name?: string | null
          body?: string
          content_sha256?: string | null
          created_at?: string
          event_id?: string
          external_id?: string | null
          id?: string
          is_hidden?: boolean
          kind?: string
          metadata?: Json
          moderation_status?: Database["public"]["Enums"]["moderation_status"]
          published_at?: string | null
          source?: Database["public"]["Enums"]["chat_source"]
          source_created_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_moderation_actions: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          event_id: string | null
          expires_at: string | null
          id: string
          reason: string | null
          target_user_id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          event_id?: string | null
          expires_at?: string | null
          id?: string
          reason?: string | null
          target_user_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          event_id?: string | null
          expires_at?: string | null
          id?: string
          reason?: string | null
          target_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_moderation_actions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      community_chat_policy_acceptances: {
        Row: {
          accepted_at: string
          policy_version_id: string
          user_id: string
        }
        Insert: {
          accepted_at?: string
          policy_version_id: string
          user_id: string
        }
        Update: {
          accepted_at?: string
          policy_version_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_chat_policy_acceptances_policy_version_id_fkey"
            columns: ["policy_version_id"]
            isOneToOne: false
            referencedRelation: "community_chat_policy_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      community_chat_policy_versions: {
        Row: {
          body_markdown: string
          created_at: string
          id: string
          is_active: boolean
          published_at: string | null
          summary: string[]
          title: string
          version: string
        }
        Insert: {
          body_markdown: string
          created_at?: string
          id?: string
          is_active?: boolean
          published_at?: string | null
          summary: string[]
          title: string
          version: string
        }
        Update: {
          body_markdown?: string
          created_at?: string
          id?: string
          is_active?: boolean
          published_at?: string | null
          summary?: string[]
          title?: string
          version?: string
        }
        Relationships: []
      }
      community_chat_restrictions: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          kind: Database["public"]["Enums"]["community_restriction_kind"]
          lift_reason: string | null
          lifted_at: string | null
          reason: string
          room_id: string | null
          source_message_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["community_restriction_kind"]
          lift_reason?: string | null
          lifted_at?: string | null
          reason: string
          room_id?: string | null
          source_message_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["community_restriction_kind"]
          lift_reason?: string | null
          lifted_at?: string | null
          reason?: string
          room_id?: string | null
          source_message_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_chat_restrictions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "community_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_chat_restrictions_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "community_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      community_chat_seed_batches: {
        Row: {
          cleared_at: string | null
          created_at: string
          id: string
          message_count: number
          messages_per_room: number
          notes: string | null
          persona_count: number
          room_count: number
        }
        Insert: {
          cleared_at?: string | null
          created_at?: string
          id?: string
          message_count?: number
          messages_per_room?: number
          notes?: string | null
          persona_count?: number
          room_count?: number
        }
        Update: {
          cleared_at?: string | null
          created_at?: string
          id?: string
          message_count?: number
          messages_per_room?: number
          notes?: string | null
          persona_count?: number
          room_count?: number
        }
        Relationships: []
      }
      community_message_flags: {
        Row: {
          category: Database["public"]["Enums"]["community_flag_category"]
          created_at: string
          detail: string | null
          id: string
          message_id: string
          reporter_user_id: string | null
          resolution_note: string | null
          resolved_at: string | null
          room_id: string
          signals: Json
          source: Database["public"]["Enums"]["community_flag_source"]
          status: Database["public"]["Enums"]["community_flag_status"]
        }
        Insert: {
          category: Database["public"]["Enums"]["community_flag_category"]
          created_at?: string
          detail?: string | null
          id?: string
          message_id: string
          reporter_user_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          room_id: string
          signals?: Json
          source: Database["public"]["Enums"]["community_flag_source"]
          status?: Database["public"]["Enums"]["community_flag_status"]
        }
        Update: {
          category?: Database["public"]["Enums"]["community_flag_category"]
          created_at?: string
          detail?: string | null
          id?: string
          message_id?: string
          reporter_user_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          room_id?: string
          signals?: Json
          source?: Database["public"]["Enums"]["community_flag_source"]
          status?: Database["public"]["Enums"]["community_flag_status"]
        }
        Relationships: [
          {
            foreignKeyName: "community_message_flags_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "community_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_message_flags_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "community_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      community_messages: {
        Row: {
          author_avatar_url: string | null
          author_badge: Database["public"]["Enums"]["community_badge"]
          author_display_name: string | null
          author_handle: string | null
          body: string
          client_attempt_id: string
          content_sha256: string | null
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          hidden_at: string | null
          hidden_reason: string | null
          id: string
          metadata: Json
          moderation_status: Database["public"]["Enums"]["moderation_status"]
          published_at: string | null
          report_count: number
          room_id: string
          screened_at: string | null
          screening: Json
          seed_batch_id: string | null
          user_id: string
        }
        Insert: {
          author_avatar_url?: string | null
          author_badge?: Database["public"]["Enums"]["community_badge"]
          author_display_name?: string | null
          author_handle?: string | null
          body: string
          client_attempt_id: string
          content_sha256?: string | null
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          hidden_at?: string | null
          hidden_reason?: string | null
          id?: string
          metadata?: Json
          moderation_status?: Database["public"]["Enums"]["moderation_status"]
          published_at?: string | null
          report_count?: number
          room_id: string
          screened_at?: string | null
          screening?: Json
          seed_batch_id?: string | null
          user_id: string
        }
        Update: {
          author_avatar_url?: string | null
          author_badge?: Database["public"]["Enums"]["community_badge"]
          author_display_name?: string | null
          author_handle?: string | null
          body?: string
          client_attempt_id?: string
          content_sha256?: string | null
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          hidden_at?: string | null
          hidden_reason?: string | null
          id?: string
          metadata?: Json
          moderation_status?: Database["public"]["Enums"]["moderation_status"]
          published_at?: string | null
          report_count?: number
          room_id?: string
          screened_at?: string | null
          screening?: Json
          seed_batch_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "community_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      community_moderation_actions: {
        Row: {
          action: Database["public"]["Enums"]["community_moderation_action_kind"]
          actor: Database["public"]["Enums"]["community_moderation_actor"]
          actor_reference: string | null
          created_at: string
          id: string
          message_id: string | null
          metadata: Json
          reason: string | null
          restriction_id: string | null
          room_id: string | null
          target_user_id: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["community_moderation_action_kind"]
          actor: Database["public"]["Enums"]["community_moderation_actor"]
          actor_reference?: string | null
          created_at?: string
          id?: string
          message_id?: string | null
          metadata?: Json
          reason?: string | null
          restriction_id?: string | null
          room_id?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["community_moderation_action_kind"]
          actor?: Database["public"]["Enums"]["community_moderation_actor"]
          actor_reference?: string | null
          created_at?: string
          id?: string
          message_id?: string | null
          metadata?: Json
          reason?: string | null
          restriction_id?: string | null
          room_id?: string | null
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_moderation_actions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "community_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_moderation_actions_restriction_id_fkey"
            columns: ["restriction_id"]
            isOneToOne: false
            referencedRelation: "community_chat_restrictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_moderation_actions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "community_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      community_room_grants: {
        Row: {
          created_at: string
          grant_kind: Database["public"]["Enums"]["community_grant_kind"]
          id: string
          role: Database["public"]["Enums"]["app_role"] | null
          room_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          grant_kind: Database["public"]["Enums"]["community_grant_kind"]
          id?: string
          role?: Database["public"]["Enums"]["app_role"] | null
          room_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          grant_kind?: Database["public"]["Enums"]["community_grant_kind"]
          id?: string
          role?: Database["public"]["Enums"]["app_role"] | null
          room_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_room_grants_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "community_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      community_rooms: {
        Row: {
          access_policy: Database["public"]["Enums"]["community_access_policy"]
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          room_kind: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          access_policy?: Database["public"]["Enums"]["community_access_policy"]
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          room_kind?: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          access_policy?: Database["public"]["Enums"]["community_access_policy"]
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          room_kind?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      community_standards_versions: {
        Row: {
          body_markdown: string
          created_at: string
          id: string
          is_active: boolean
          published_at: string | null
          published_by: string | null
          title: string
          version: string
        }
        Insert: {
          body_markdown: string
          created_at?: string
          id?: string
          is_active?: boolean
          published_at?: string | null
          published_by?: string | null
          title: string
          version: string
        }
        Update: {
          body_markdown?: string
          created_at?: string
          id?: string
          is_active?: boolean
          published_at?: string | null
          published_by?: string | null
          title?: string
          version?: string
        }
        Relationships: []
      }
      event_chat_channels: {
        Row: {
          channel_id: string
          created_at: string
          enabled: boolean
          event_id: string
          id: string
          last_polled_at: string | null
          platform: string
          updated_at: string
          youtube_live_chat_id: string | null
          youtube_page_token: string | null
        }
        Insert: {
          channel_id: string
          created_at?: string
          enabled?: boolean
          event_id: string
          id?: string
          last_polled_at?: string | null
          platform: string
          updated_at?: string
          youtube_live_chat_id?: string | null
          youtube_page_token?: string | null
        }
        Update: {
          channel_id?: string
          created_at?: string
          enabled?: boolean
          event_id?: string
          id?: string
          last_polled_at?: string | null
          platform?: string
          updated_at?: string
          youtube_live_chat_id?: string | null
          youtube_page_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_chat_channels_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_passes: {
        Row: {
          access_token_hash: string | null
          access_type: Database["public"]["Enums"]["event_access_type"]
          activated_at: string | null
          created_at: string
          event_id: string
          expires_at: string | null
          granted_free: boolean
          id: string
          payment_record_id: string | null
          purchaser_email: string | null
          status: Database["public"]["Enums"]["event_pass_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          access_token_hash?: string | null
          access_type?: Database["public"]["Enums"]["event_access_type"]
          activated_at?: string | null
          created_at?: string
          event_id: string
          expires_at?: string | null
          granted_free?: boolean
          id?: string
          payment_record_id?: string | null
          purchaser_email?: string | null
          status?: Database["public"]["Enums"]["event_pass_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          access_token_hash?: string | null
          access_type?: Database["public"]["Enums"]["event_access_type"]
          activated_at?: string | null
          created_at?: string
          event_id?: string
          expires_at?: string | null
          granted_free?: boolean
          id?: string
          payment_record_id?: string | null
          purchaser_email?: string | null
          status?: Database["public"]["Enums"]["event_pass_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_passes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_passes_payment_record_id_fkey"
            columns: ["payment_record_id"]
            isOneToOne: false
            referencedRelation: "payment_records"
            referencedColumns: ["id"]
          },
        ]
      }
      event_presence: {
        Row: {
          event_id: string
          id: string
          last_seen_at: string
          user_id: string
        }
        Insert: {
          event_id: string
          id?: string
          last_seen_at?: string
          user_id: string
        }
        Update: {
          event_id?: string
          id?: string
          last_seen_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_presence_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_reminders: {
        Row: {
          created_at: string
          event_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_reminders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          access_mode: Database["public"]["Enums"]["event_access_mode"]
          actual_start_at: string | null
          allow_guest_comment: boolean
          allow_watch_and_chat_purchase: boolean
          allow_watch_purchase: boolean
          chat_enabled: boolean
          cover_path: string | null
          created_at: string
          created_by: string | null
          description: string | null
          embed_url: string | null
          ended_at: string | null
          guest_comment_price_minor: number | null
          host_business_id: string | null
          id: string
          pass_currency: string
          pass_price_minor: number | null
          pricing_currency: string
          provider: string | null
          provider_account_id: string | null
          provider_record_id: string | null
          replay_available_at: string | null
          replay_url_path: string | null
          restream_event_id: string | null
          scheduled_start_at: string | null
          slug: string
          speaker_requests_enabled: boolean
          status: Database["public"]["Enums"]["event_status"]
          stripe_price_id: string | null
          stripe_product_id: string | null
          tips_enabled: boolean
          title: string
          updated_at: string
          watch_and_chat_price_minor: number | null
          watch_price_minor: number | null
        }
        Insert: {
          access_mode?: Database["public"]["Enums"]["event_access_mode"]
          actual_start_at?: string | null
          allow_guest_comment?: boolean
          allow_watch_and_chat_purchase?: boolean
          allow_watch_purchase?: boolean
          chat_enabled?: boolean
          cover_path?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          embed_url?: string | null
          ended_at?: string | null
          guest_comment_price_minor?: number | null
          host_business_id?: string | null
          id?: string
          pass_currency?: string
          pass_price_minor?: number | null
          pricing_currency?: string
          provider?: string | null
          provider_account_id?: string | null
          provider_record_id?: string | null
          replay_available_at?: string | null
          replay_url_path?: string | null
          restream_event_id?: string | null
          scheduled_start_at?: string | null
          slug: string
          speaker_requests_enabled?: boolean
          status?: Database["public"]["Enums"]["event_status"]
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          tips_enabled?: boolean
          title: string
          updated_at?: string
          watch_and_chat_price_minor?: number | null
          watch_price_minor?: number | null
        }
        Update: {
          access_mode?: Database["public"]["Enums"]["event_access_mode"]
          actual_start_at?: string | null
          allow_guest_comment?: boolean
          allow_watch_and_chat_purchase?: boolean
          allow_watch_purchase?: boolean
          chat_enabled?: boolean
          cover_path?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          embed_url?: string | null
          ended_at?: string | null
          guest_comment_price_minor?: number | null
          host_business_id?: string | null
          id?: string
          pass_currency?: string
          pass_price_minor?: number | null
          pricing_currency?: string
          provider?: string | null
          provider_account_id?: string | null
          provider_record_id?: string | null
          replay_available_at?: string | null
          replay_url_path?: string | null
          restream_event_id?: string | null
          scheduled_start_at?: string | null
          slug?: string
          speaker_requests_enabled?: boolean
          status?: Database["public"]["Enums"]["event_status"]
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          tips_enabled?: boolean
          title?: string
          updated_at?: string
          watch_and_chat_price_minor?: number | null
          watch_price_minor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "events_host_business_id_fkey"
            columns: ["host_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      lender_profiles: {
        Row: {
          business_name: string
          capital_available: string
          capital_source: string
          consent_at: string
          content_risk: string
          created_at: string
          email: string
          full_name: string
          id: string
          lender_type: string
          network_capacity: number | null
          nmls_id: string | null
          notes: string | null
          phone: string
          role: string
          states: Json
          status: string
          submitted_ip_hash: string | null
          updated_at: string
          user_agent_hash: string | null
          website: string | null
        }
        Insert: {
          business_name: string
          capital_available: string
          capital_source: string
          consent_at: string
          content_risk?: string
          created_at?: string
          email: string
          full_name: string
          id?: string
          lender_type: string
          network_capacity?: number | null
          nmls_id?: string | null
          notes?: string | null
          phone: string
          role: string
          states: Json
          status?: string
          submitted_ip_hash?: string | null
          updated_at?: string
          user_agent_hash?: string | null
          website?: string | null
        }
        Update: {
          business_name?: string
          capital_available?: string
          capital_source?: string
          consent_at?: string
          content_risk?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          lender_type?: string
          network_capacity?: number | null
          nmls_id?: string | null
          notes?: string | null
          phone?: string
          role?: string
          states?: Json
          status?: string
          submitted_ip_hash?: string | null
          updated_at?: string
          user_agent_hash?: string | null
          website?: string | null
        }
        Relationships: []
      }
      live_alert_deliveries: {
        Row: {
          channel: Database["public"]["Enums"]["live_alert_channel"]
          created_at: string
          error_detail: string | null
          event_id: string
          id: string
          kind: Database["public"]["Enums"]["live_alert_kind"]
          sent_at: string | null
          status: Database["public"]["Enums"]["live_alert_status"]
          user_id: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["live_alert_channel"]
          created_at?: string
          error_detail?: string | null
          event_id: string
          id?: string
          kind?: Database["public"]["Enums"]["live_alert_kind"]
          sent_at?: string | null
          status?: Database["public"]["Enums"]["live_alert_status"]
          user_id: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["live_alert_channel"]
          created_at?: string
          error_detail?: string | null
          event_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["live_alert_kind"]
          sent_at?: string | null
          status?: Database["public"]["Enums"]["live_alert_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_alert_deliveries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      live_alert_preferences: {
        Row: {
          email_opt_in: boolean
          sms_opt_in: boolean
          sms_phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          email_opt_in?: boolean
          sms_opt_in?: boolean
          sms_phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          email_opt_in?: boolean
          sms_opt_in?: boolean
          sms_phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      membership_subscriptions: {
        Row: {
          billing_customer_id: string
          cancel_at_period_end: boolean
          canceled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          grace_expires_at: string | null
          id: string
          status: Database["public"]["Enums"]["membership_subscription_status"]
          stripe_account_id: string
          stripe_price_id: string
          stripe_product_id: string
          stripe_subscription_id: string
          tier_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          billing_customer_id: string
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          grace_expires_at?: string | null
          id?: string
          status: Database["public"]["Enums"]["membership_subscription_status"]
          stripe_account_id: string
          stripe_price_id: string
          stripe_product_id: string
          stripe_subscription_id: string
          tier_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          billing_customer_id?: string
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          grace_expires_at?: string | null
          id?: string
          status?: Database["public"]["Enums"]["membership_subscription_status"]
          stripe_account_id?: string
          stripe_price_id?: string
          stripe_product_id?: string
          stripe_subscription_id?: string
          tier_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_subscriptions_billing_customer_id_fkey"
            columns: ["billing_customer_id"]
            isOneToOne: false
            referencedRelation: "billing_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_tiers: {
        Row: {
          audience: string
          business_features: Json
          created_at: string
          cta_label: string
          currency: string
          description: string | null
          features: Json
          grants_vendor_verification: boolean
          highlight_feature: string | null
          id: string
          is_active: boolean
          is_popular: boolean
          name: string
          price_annual_minor: number | null
          price_monthly_minor: number
          slug: string
          sort_order: number
          stripe_price_id_annual: string | null
          stripe_price_id_monthly: string | null
          updated_at: string
        }
        Insert: {
          audience?: string
          business_features?: Json
          created_at?: string
          cta_label?: string
          currency?: string
          description?: string | null
          features?: Json
          grants_vendor_verification?: boolean
          highlight_feature?: string | null
          id?: string
          is_active?: boolean
          is_popular?: boolean
          name: string
          price_annual_minor?: number | null
          price_monthly_minor: number
          slug: string
          sort_order?: number
          stripe_price_id_annual?: string | null
          stripe_price_id_monthly?: string | null
          updated_at?: string
        }
        Update: {
          audience?: string
          business_features?: Json
          created_at?: string
          cta_label?: string
          currency?: string
          description?: string | null
          features?: Json
          grants_vendor_verification?: boolean
          highlight_feature?: string | null
          id?: string
          is_active?: boolean
          is_popular?: boolean
          name?: string
          price_annual_minor?: number | null
          price_monthly_minor?: number
          slug?: string
          sort_order?: number
          stripe_price_id_annual?: string | null
          stripe_price_id_monthly?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      migration_batches: {
        Row: {
          dry_run: boolean
          finished_at: string | null
          id: string
          notes: string | null
          source_system: string
          started_at: string
          status: string
        }
        Insert: {
          dry_run?: boolean
          finished_at?: string | null
          id?: string
          notes?: string | null
          source_system: string
          started_at?: string
          status?: string
        }
        Update: {
          dry_run?: boolean
          finished_at?: string | null
          id?: string
          notes?: string | null
          source_system?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      migration_record_map: {
        Row: {
          batch_id: string | null
          id: string
          legacy_id: string
          migrated_at: string
          source_system: string
          target_id: string | null
          target_table: string
        }
        Insert: {
          batch_id?: string | null
          id?: string
          legacy_id: string
          migrated_at?: string
          source_system: string
          target_id?: string | null
          target_table: string
        }
        Update: {
          batch_id?: string | null
          id?: string
          legacy_id?: string
          migrated_at?: string
          source_system?: string
          target_id?: string | null
          target_table?: string
        }
        Relationships: [
          {
            foreignKeyName: "migration_record_map_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "migration_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      paid_comments: {
        Row: {
          approved_body_sha256: string | null
          automated_moderation: Json
          body: string
          body_sha256: string
          chat_message_id: string | null
          created_at: string
          event_id: string
          expires_at: string | null
          guest_display_name: string
          guest_email: string
          id: string
          moderated_at: string | null
          moderator_note: string | null
          moderator_user_id: string | null
          payment_record_id: string | null
          standards_version_id: string
          status: Database["public"]["Enums"]["paid_comment_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          approved_body_sha256?: string | null
          automated_moderation?: Json
          body: string
          body_sha256: string
          chat_message_id?: string | null
          created_at?: string
          event_id: string
          expires_at?: string | null
          guest_display_name: string
          guest_email: string
          id?: string
          moderated_at?: string | null
          moderator_note?: string | null
          moderator_user_id?: string | null
          payment_record_id?: string | null
          standards_version_id: string
          status?: Database["public"]["Enums"]["paid_comment_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          approved_body_sha256?: string | null
          automated_moderation?: Json
          body?: string
          body_sha256?: string
          chat_message_id?: string | null
          created_at?: string
          event_id?: string
          expires_at?: string | null
          guest_display_name?: string
          guest_email?: string
          id?: string
          moderated_at?: string | null
          moderator_note?: string | null
          moderator_user_id?: string | null
          payment_record_id?: string | null
          standards_version_id?: string
          status?: Database["public"]["Enums"]["paid_comment_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paid_comments_chat_message_fk"
            columns: ["chat_message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paid_comments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paid_comments_payment_record_id_fkey"
            columns: ["payment_record_id"]
            isOneToOne: false
            referencedRelation: "payment_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paid_comments_standards_version_id_fkey"
            columns: ["standards_version_id"]
            isOneToOne: false
            referencedRelation: "community_standards_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          attempt_count: number
          created_at: string
          event_type: string | null
          id: string
          livemode: boolean | null
          payload: Json
          payment_record_id: string | null
          processed_at: string | null
          processing_error: string | null
          provider: string
          provider_account_id: string | null
          provider_event_id: string
          tip_id: string | null
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          event_type?: string | null
          id?: string
          livemode?: boolean | null
          payload?: Json
          payment_record_id?: string | null
          processed_at?: string | null
          processing_error?: string | null
          provider: string
          provider_account_id?: string | null
          provider_event_id: string
          tip_id?: string | null
        }
        Update: {
          attempt_count?: number
          created_at?: string
          event_type?: string | null
          id?: string
          livemode?: boolean | null
          payload?: Json
          payment_record_id?: string | null
          processed_at?: string | null
          processing_error?: string | null
          provider?: string
          provider_account_id?: string | null
          provider_event_id?: string
          tip_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_payment_record_id_fkey"
            columns: ["payment_record_id"]
            isOneToOne: false
            referencedRelation: "payment_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_events_tip_id_fkey"
            columns: ["tip_id"]
            isOneToOne: false
            referencedRelation: "tips"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_records: {
        Row: {
          amount_minor: number
          charge_id: string | null
          checkout_session_id: string | null
          created_at: string
          crypto_transaction_id: string | null
          currency: string
          event_id: string | null
          id: string
          idempotency_key: string
          kind: Database["public"]["Enums"]["payment_kind"]
          metadata: Json
          paid_at: string | null
          payment_intent_id: string | null
          provider: string
          provider_account_id: string | null
          refunded_amount_minor: number
          status: Database["public"]["Enums"]["payment_status"]
          stripe_customer_id: string | null
          tip_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount_minor: number
          charge_id?: string | null
          checkout_session_id?: string | null
          created_at?: string
          crypto_transaction_id?: string | null
          currency: string
          event_id?: string | null
          id?: string
          idempotency_key: string
          kind: Database["public"]["Enums"]["payment_kind"]
          metadata?: Json
          paid_at?: string | null
          payment_intent_id?: string | null
          provider: string
          provider_account_id?: string | null
          refunded_amount_minor?: number
          status?: Database["public"]["Enums"]["payment_status"]
          stripe_customer_id?: string | null
          tip_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount_minor?: number
          charge_id?: string | null
          checkout_session_id?: string | null
          created_at?: string
          crypto_transaction_id?: string | null
          currency?: string
          event_id?: string | null
          id?: string
          idempotency_key?: string
          kind?: Database["public"]["Enums"]["payment_kind"]
          metadata?: Json
          paid_at?: string | null
          payment_intent_id?: string | null
          provider?: string
          provider_account_id?: string | null
          refunded_amount_minor?: number
          status?: Database["public"]["Enums"]["payment_status"]
          stripe_customer_id?: string | null
          tip_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_records_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_records_tip_id_fkey"
            columns: ["tip_id"]
            isOneToOne: false
            referencedRelation: "tips"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_type: Database["public"]["Enums"]["account_type"]
          avatar_path: string | null
          city: string | null
          country: string | null
          created_at: string
          display_name: string | null
          email_display: string | null
          first_name: string | null
          handle: string | null
          id: string
          last_name: string | null
          onboarding_status: Database["public"]["Enums"]["onboarding_status"]
          phone: string | null
          state: string | null
          updated_at: string
        }
        Insert: {
          account_type?: Database["public"]["Enums"]["account_type"]
          avatar_path?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          display_name?: string | null
          email_display?: string | null
          first_name?: string | null
          handle?: string | null
          id: string
          last_name?: string | null
          onboarding_status?: Database["public"]["Enums"]["onboarding_status"]
          phone?: string | null
          state?: string | null
          updated_at?: string
        }
        Update: {
          account_type?: Database["public"]["Enums"]["account_type"]
          avatar_path?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          display_name?: string | null
          email_display?: string | null
          first_name?: string | null
          handle?: string | null
          id?: string
          last_name?: string | null
          onboarding_status?: Database["public"]["Enums"]["onboarding_status"]
          phone?: string | null
          state?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      properties: {
        Row: {
          address_city: string | null
          address_country: string | null
          address_line1: string | null
          address_state: string | null
          archived_at: string | null
          area_sqft: number | null
          bathrooms: number | null
          bedrooms: number | null
          business_id: string
          cover_path: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          id: string
          latitude: number | null
          longitude: number | null
          postal_code: string | null
          price_minor: number | null
          property_type: string | null
          published_at: string | null
          slug: string
          status: Database["public"]["Enums"]["property_status"]
          title: string
          updated_at: string
        }
        Insert: {
          address_city?: string | null
          address_country?: string | null
          address_line1?: string | null
          address_state?: string | null
          archived_at?: string | null
          area_sqft?: number | null
          bathrooms?: number | null
          bedrooms?: number | null
          business_id: string
          cover_path?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          postal_code?: string | null
          price_minor?: number | null
          property_type?: string | null
          published_at?: string | null
          slug: string
          status?: Database["public"]["Enums"]["property_status"]
          title: string
          updated_at?: string
        }
        Update: {
          address_city?: string | null
          address_country?: string | null
          address_line1?: string | null
          address_state?: string | null
          archived_at?: string | null
          area_sqft?: number | null
          bathrooms?: number | null
          bedrooms?: number | null
          business_id?: string
          cover_path?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          postal_code?: string | null
          price_minor?: number | null
          property_type?: string | null
          published_at?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["property_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "properties_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      property_analysis_threads: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          last_opened_at: string
          parcel_id: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_opened_at?: string
          parcel_id: string
          status?: string
          title: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_opened_at?: string
          parcel_id?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_analysis_threads_parcel_id_fkey"
            columns: ["parcel_id"]
            isOneToOne: false
            referencedRelation: "property_intel_parcels"
            referencedColumns: ["id"]
          },
        ]
      }
      property_api_access_requests: {
        Row: {
          created_at: string
          email: string
          id: string
          monthly_volume: string
          organization: string
          status: string
          updated_at: string
          use_case: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          monthly_volume: string
          organization: string
          status?: string
          updated_at?: string
          use_case: string
          user_id?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          monthly_volume?: string
          organization?: string
          status?: string
          updated_at?: string
          use_case?: string
          user_id?: string
        }
        Relationships: []
      }
      property_api_keys: {
        Row: {
          created_at: string
          id: string
          key_hash: string
          key_prefix: string
          label: string
          last_used_at: string | null
          revoked_at: string | null
          scopes: string[]
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          key_hash: string
          key_prefix: string
          label: string
          last_used_at?: string | null
          revoked_at?: string | null
          scopes?: string[]
          status?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          key_hash?: string
          key_prefix?: string
          label?: string
          last_used_at?: string | null
          revoked_at?: string | null
          scopes?: string[]
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      property_api_rate_limits: {
        Row: {
          key_id: string
          request_count: number
          window_started_at: number
        }
        Insert: {
          key_id: string
          request_count?: number
          window_started_at: number
        }
        Update: {
          key_id?: string
          request_count?: number
          window_started_at?: number
        }
        Relationships: [
          {
            foreignKeyName: "property_api_rate_limits_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "property_api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      property_api_usage_events: {
        Row: {
          created_at: string
          duration_ms: number
          id: string
          key_id: string
          rate_limited: boolean
          request_id: string
          route: string
          status_code: number
        }
        Insert: {
          created_at?: string
          duration_ms?: number
          id?: string
          key_id: string
          rate_limited?: boolean
          request_id: string
          route: string
          status_code: number
        }
        Update: {
          created_at?: string
          duration_ms?: number
          id?: string
          key_id?: string
          rate_limited?: boolean
          request_id?: string
          route?: string
          status_code?: number
        }
        Relationships: [
          {
            foreignKeyName: "property_api_usage_events_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "property_api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      property_deal_scenarios: {
        Row: {
          calculation_version: number
          created_at: string
          id: string
          inputs: Json
          label: string
          parcel_id: string | null
          property_address: string | null
          record_id: string | null
          results: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          calculation_version: number
          created_at?: string
          id?: string
          inputs: Json
          label: string
          parcel_id?: string | null
          property_address?: string | null
          record_id?: string | null
          results: Json
          updated_at?: string
          user_id?: string
        }
        Update: {
          calculation_version?: number
          created_at?: string
          id?: string
          inputs?: Json
          label?: string
          parcel_id?: string | null
          property_address?: string | null
          record_id?: string | null
          results?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      property_inquiries: {
        Row: {
          business_id: string
          contact_email: string
          contact_name: string
          contact_phone: string | null
          created_at: string
          from_user_id: string | null
          id: string
          message: string
          property_id: string
          status: Database["public"]["Enums"]["inquiry_status"]
          updated_at: string
        }
        Insert: {
          business_id: string
          contact_email: string
          contact_name: string
          contact_phone?: string | null
          created_at?: string
          from_user_id?: string | null
          id?: string
          message: string
          property_id: string
          status?: Database["public"]["Enums"]["inquiry_status"]
          updated_at?: string
        }
        Update: {
          business_id?: string
          contact_email?: string
          contact_name?: string
          contact_phone?: string | null
          created_at?: string
          from_user_id?: string | null
          id?: string
          message?: string
          property_id?: string
          status?: Database["public"]["Enums"]["inquiry_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_inquiries_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_inquiries_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_intel_parcels: {
        Row: {
          asr_parcel_id: string
          created_at: string
          current_address: string | null
          id: string
          last_intelligence_sync_at: string | null
          match_status: string
          updated_at: string
        }
        Insert: {
          asr_parcel_id: string
          created_at?: string
          current_address?: string | null
          id?: string
          last_intelligence_sync_at?: string | null
          match_status?: string
          updated_at?: string
        }
        Update: {
          asr_parcel_id?: string
          created_at?: string
          current_address?: string | null
          id?: string
          last_intelligence_sync_at?: string | null
          match_status?: string
          updated_at?: string
        }
        Relationships: []
      }
      property_intel_profiles: {
        Row: {
          abatement_end_year: number | null
          abatement_start_year: number | null
          appraised_improvement_value: number | null
          appraised_land_value: number | null
          assessed_improvement_value: number | null
          assessed_land_value: number | null
          assessed_total_value: number | null
          assessor_class_code: string | null
          assessor_handle: string | null
          city_block: number | null
          commercial_building_count: number | null
          first_year_built: number | null
          frontage_feet: number | null
          is_tax_abated: boolean | null
          land_area: number | null
          land_use_code: string | null
          last_residential_sale_date: string | null
          last_residential_sale_price: number | null
          last_year_built: number | null
          legal_description: string | null
          lot_square_feet: number | null
          neighborhood_code: string | null
          number_of_apartments: number | null
          number_of_units: number | null
          observed_at: string
          owner_name: string | null
          owner_name_2: string | null
          owner_occupied: boolean | null
          parcel_id: string
          parcel_number: number | null
          prior_tax_amount: number | null
          property_class_code: number | null
          residential_building_count: number | null
          source_url: string
          tax_balance: number | null
          vacant_building_year: number | null
          vacant_lot: boolean | null
          ward: number | null
          web_mercator_x: number | null
          web_mercator_y: number | null
          zip_code: string | null
          zoning: string | null
        }
        Insert: {
          abatement_end_year?: number | null
          abatement_start_year?: number | null
          appraised_improvement_value?: number | null
          appraised_land_value?: number | null
          assessed_improvement_value?: number | null
          assessed_land_value?: number | null
          assessed_total_value?: number | null
          assessor_class_code?: string | null
          assessor_handle?: string | null
          city_block?: number | null
          commercial_building_count?: number | null
          first_year_built?: number | null
          frontage_feet?: number | null
          is_tax_abated?: boolean | null
          land_area?: number | null
          land_use_code?: string | null
          last_residential_sale_date?: string | null
          last_residential_sale_price?: number | null
          last_year_built?: number | null
          legal_description?: string | null
          lot_square_feet?: number | null
          neighborhood_code?: string | null
          number_of_apartments?: number | null
          number_of_units?: number | null
          observed_at?: string
          owner_name?: string | null
          owner_name_2?: string | null
          owner_occupied?: boolean | null
          parcel_id: string
          parcel_number?: number | null
          prior_tax_amount?: number | null
          property_class_code?: number | null
          residential_building_count?: number | null
          source_url: string
          tax_balance?: number | null
          vacant_building_year?: number | null
          vacant_lot?: boolean | null
          ward?: number | null
          web_mercator_x?: number | null
          web_mercator_y?: number | null
          zip_code?: string | null
          zoning?: string | null
        }
        Update: {
          abatement_end_year?: number | null
          abatement_start_year?: number | null
          appraised_improvement_value?: number | null
          appraised_land_value?: number | null
          assessed_improvement_value?: number | null
          assessed_land_value?: number | null
          assessed_total_value?: number | null
          assessor_class_code?: string | null
          assessor_handle?: string | null
          city_block?: number | null
          commercial_building_count?: number | null
          first_year_built?: number | null
          frontage_feet?: number | null
          is_tax_abated?: boolean | null
          land_area?: number | null
          land_use_code?: string | null
          last_residential_sale_date?: string | null
          last_residential_sale_price?: number | null
          last_year_built?: number | null
          legal_description?: string | null
          lot_square_feet?: number | null
          neighborhood_code?: string | null
          number_of_apartments?: number | null
          number_of_units?: number | null
          observed_at?: string
          owner_name?: string | null
          owner_name_2?: string | null
          owner_occupied?: boolean | null
          parcel_id?: string
          parcel_number?: number | null
          prior_tax_amount?: number | null
          property_class_code?: number | null
          residential_building_count?: number | null
          source_url?: string
          tax_balance?: number | null
          vacant_building_year?: number | null
          vacant_lot?: boolean | null
          ward?: number | null
          web_mercator_x?: number | null
          web_mercator_y?: number | null
          zip_code?: string | null
          zoning?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_intel_profiles_parcel_id_fkey"
            columns: ["parcel_id"]
            isOneToOne: true
            referencedRelation: "property_intel_parcels"
            referencedColumns: ["id"]
          },
        ]
      }
      property_intelligence_access_grants: {
        Row: {
          granted_at: string
          granted_by: string | null
          note: string | null
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          note?: string | null
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          note?: string | null
          user_id?: string
        }
        Relationships: []
      }
      property_intelligence_settings: {
        Row: {
          access_mode: string
          id: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          access_mode?: string
          id?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          access_mode?: string
          id?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      property_media: {
        Row: {
          alt_text: string | null
          created_at: string
          id: string
          property_id: string
          sort_order: number
          storage_path: string
        }
        Insert: {
          alt_text?: string | null
          created_at?: string
          id?: string
          property_id: string
          sort_order?: number
          storage_path: string
        }
        Update: {
          alt_text?: string | null
          created_at?: string
          id?: string
          property_id?: string
          sort_order?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_media_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_owner_documents: {
        Row: {
          amount: number | null
          byte_size: number
          category: string
          content_type: string
          created_at: string
          description: string | null
          file_hash: string
          id: string
          occurred_at: string | null
          original_filename: string
          reference_number: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          storage_path: string
          thread_id: string
          title: string
          updated_at: string
          user_id: string
          vendor_name: string | null
        }
        Insert: {
          amount?: number | null
          byte_size: number
          category: string
          content_type: string
          created_at?: string
          description?: string | null
          file_hash: string
          id?: string
          occurred_at?: string | null
          original_filename: string
          reference_number?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          storage_path: string
          thread_id: string
          title: string
          updated_at?: string
          user_id?: string
          vendor_name?: string | null
        }
        Update: {
          amount?: number | null
          byte_size?: number
          category?: string
          content_type?: string
          created_at?: string
          description?: string | null
          file_hash?: string
          id?: string
          occurred_at?: string | null
          original_filename?: string
          reference_number?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          storage_path?: string
          thread_id?: string
          title?: string
          updated_at?: string
          user_id?: string
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_owner_documents_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "property_analysis_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      property_record_reviews: {
        Row: {
          created_at: string
          decision: string
          id: string
          note: string | null
          reviewer_id: string
          submission_id: string
        }
        Insert: {
          created_at?: string
          decision: string
          id?: string
          note?: string | null
          reviewer_id?: string
          submission_id: string
        }
        Update: {
          created_at?: string
          decision?: string
          id?: string
          note?: string | null
          reviewer_id?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_record_reviews_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "property_owner_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      property_report_deliveries: {
        Row: {
          action: string
          created_at: string
          id: string
          report_id: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          report_id: string
          user_id?: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          report_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_report_deliveries_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "property_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      property_reports: {
        Row: {
          content_hash: string
          created_at: string
          deal_scenario_id: string | null
          id: string
          pdf_hash: string
          pdf_size: number
          snapshot_hash: string
          snapshot_json: Json
          storage_path: string
          thread_id: string
          user_id: string
          version: number
        }
        Insert: {
          content_hash: string
          created_at?: string
          deal_scenario_id?: string | null
          id?: string
          pdf_hash: string
          pdf_size: number
          snapshot_hash: string
          snapshot_json: Json
          storage_path: string
          thread_id: string
          user_id?: string
          version: number
        }
        Update: {
          content_hash?: string
          created_at?: string
          deal_scenario_id?: string | null
          id?: string
          pdf_hash?: string
          pdf_size?: number
          snapshot_hash?: string
          snapshot_json?: Json
          storage_path?: string
          thread_id?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "property_reports_deal_scenario_id_fkey"
            columns: ["deal_scenario_id"]
            isOneToOne: false
            referencedRelation: "property_deal_scenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_reports_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "property_analysis_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_health: {
        Row: {
          details: Json
          last_connected_at: string | null
          last_error_at: string | null
          last_error_code: string | null
          last_event_at: string | null
          provider: string
          status: Database["public"]["Enums"]["provider_health_status"]
          updated_at: string
        }
        Insert: {
          details?: Json
          last_connected_at?: string | null
          last_error_at?: string | null
          last_error_code?: string | null
          last_event_at?: string | null
          provider: string
          status?: Database["public"]["Enums"]["provider_health_status"]
          updated_at?: string
        }
        Update: {
          details?: Json
          last_connected_at?: string | null
          last_error_at?: string | null
          last_error_code?: string | null
          last_event_at?: string | null
          provider?: string
          status?: Database["public"]["Enums"]["provider_health_status"]
          updated_at?: string
        }
        Relationships: []
      }
      saved_properties: {
        Row: {
          created_at: string
          id: string
          property_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          property_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          property_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_properties_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      service_inquiries: {
        Row: {
          business_id: string
          contact_email: string
          contact_name: string
          contact_phone: string | null
          created_at: string
          from_user_id: string | null
          id: string
          message: string
          service_id: string
          status: Database["public"]["Enums"]["inquiry_status"]
          updated_at: string
        }
        Insert: {
          business_id: string
          contact_email: string
          contact_name: string
          contact_phone?: string | null
          created_at?: string
          from_user_id?: string | null
          id?: string
          message: string
          service_id: string
          status?: Database["public"]["Enums"]["inquiry_status"]
          updated_at?: string
        }
        Update: {
          business_id?: string
          contact_email?: string
          contact_name?: string
          contact_phone?: string | null
          created_at?: string
          from_user_id?: string | null
          id?: string
          message?: string
          service_id?: string
          status?: Database["public"]["Enums"]["inquiry_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_inquiries_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_inquiries_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          business_id: string
          category: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          id: string
          image_path: string | null
          name: string
          price_minor: number | null
          price_note: string | null
          published_at: string | null
          service_areas: string[]
          slug: string
          status: Database["public"]["Enums"]["service_status"]
          summary: string | null
          updated_at: string
        }
        Insert: {
          business_id: string
          category?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          id?: string
          image_path?: string | null
          name: string
          price_minor?: number | null
          price_note?: string | null
          published_at?: string | null
          service_areas?: string[]
          slug: string
          status?: Database["public"]["Enums"]["service_status"]
          summary?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          category?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          id?: string
          image_path?: string | null
          name?: string
          price_minor?: number | null
          price_note?: string | null
          published_at?: string | null
          service_areas?: string[]
          slug?: string
          status?: Database["public"]["Enums"]["service_status"]
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      speaker_requests: {
        Row: {
          created_at: string
          event_id: string
          guest_link_ciphertext: string | null
          guest_link_expires_at: string | null
          guest_link_iv: string | null
          guest_link_token_hash: string | null
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["speaker_request_status"]
          topic: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          guest_link_ciphertext?: string | null
          guest_link_expires_at?: string | null
          guest_link_iv?: string | null
          guest_link_token_hash?: string | null
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["speaker_request_status"]
          topic: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          guest_link_ciphertext?: string | null
          guest_link_expires_at?: string | null
          guest_link_iv?: string | null
          guest_link_token_hash?: string | null
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["speaker_request_status"]
          topic?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "speaker_requests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_catalog_items: {
        Row: {
          active: boolean
          amount_minor: number
          billing_interval: string | null
          catalog_key: string
          created_at: string
          currency: string
          id: string
          kind: Database["public"]["Enums"]["payment_kind"]
          stripe_account_id: string
          stripe_price_id: string
          stripe_product_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          amount_minor: number
          billing_interval?: string | null
          catalog_key: string
          created_at?: string
          currency: string
          id?: string
          kind: Database["public"]["Enums"]["payment_kind"]
          stripe_account_id: string
          stripe_price_id: string
          stripe_product_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          amount_minor?: number
          billing_interval?: string | null
          catalog_key?: string
          created_at?: string
          currency?: string
          id?: string
          kind?: Database["public"]["Enums"]["payment_kind"]
          stripe_account_id?: string
          stripe_price_id?: string
          stripe_product_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tips: {
        Row: {
          amount_minor: number
          created_at: string
          currency: string
          deposit_address: string | null
          event_id: string | null
          from_user_id: string | null
          guest_display_name: string | null
          id: string
          idempotency_key: string
          message: string | null
          message_sha256: string | null
          paid_at: string | null
          provider: string | null
          provider_record_id: string | null
          quote_expires_at: string | null
          status: Database["public"]["Enums"]["tip_status"]
          to_business_id: string | null
          updated_at: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          currency?: string
          deposit_address?: string | null
          event_id?: string | null
          from_user_id?: string | null
          guest_display_name?: string | null
          id?: string
          idempotency_key: string
          message?: string | null
          message_sha256?: string | null
          paid_at?: string | null
          provider?: string | null
          provider_record_id?: string | null
          quote_expires_at?: string | null
          status?: Database["public"]["Enums"]["tip_status"]
          to_business_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          currency?: string
          deposit_address?: string | null
          event_id?: string | null
          from_user_id?: string | null
          guest_display_name?: string | null
          id?: string
          idempotency_key?: string
          message?: string | null
          message_sha256?: string | null
          paid_at?: string | null
          provider?: string | null
          provider_record_id?: string | null
          quote_expires_at?: string | null
          status?: Database["public"]["Enums"]["tip_status"]
          to_business_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tips_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tips_to_business_id_fkey"
            columns: ["to_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          granted_at: string
          granted_by: string | null
          id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          revoked_at?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_access_community_room: {
        Args: { _room_id: string; _user_id?: string }
        Returns: boolean
      }
      can_manage_business: {
        Args: { _business_id: string; _user_id: string }
        Returns: boolean
      }
      can_view_event_presence: {
        Args: { _event_id: string; _user_id: string }
        Returns: boolean
      }
      clear_community_chat_seed_messages: { Args: never; Returns: number }
      community_chat_restriction: {
        Args: { _room_id: string; _user_id: string }
        Returns: {
          expires_at: string
          kind: Database["public"]["Enums"]["community_restriction_kind"]
          reason: string
          restriction_id: string
          room_id: string
        }[]
      }
      community_chat_seed_insert_batch: {
        Args: { payload: Json }
        Returns: number
      }
      community_room_visible_to: {
        Args: {
          _access_policy: Database["public"]["Enums"]["community_access_policy"]
          _room_id: string
          _user_id: string
        }
        Returns: boolean
      }
      consume_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window_ms: number }
        Returns: {
          allowed: boolean
          retry_after_seconds: number
        }[]
      }
      ensure_community_chat_seed_users: {
        Args: never
        Returns: {
          seed_author_badge: Database["public"]["Enums"]["community_badge"]
          seed_avatar_url: string
          seed_display_name: string
          seed_handle: string
          seed_user_id: string
        }[]
      }
      get_business_workspace_metrics: {
        Args: { p_business_id: string }
        Returns: {
          lead_count: number
          property_count: number
          service_count: number
        }[]
      }
      get_my_business_profile: {
        Args: { p_business_id: string }
        Returns: {
          address_city: string | null
          address_country: string | null
          address_state: string | null
          cover_path: string | null
          created_at: string
          created_by: string | null
          description: string | null
          display_name: string
          employee_count_range: string | null
          entity_type: string | null
          formation_state: string | null
          handle: string | null
          headline: string | null
          id: string
          legal_name: string
          logo_path: string | null
          primary_industry: string | null
          profile_status: Database["public"]["Enums"]["profile_status"]
          public_email: string | null
          public_phone: string | null
          public_profile_enabled: boolean
          published_at: string | null
          service_areas: string[]
          slug: string
          tax_id_last4: string | null
          updated_at: string
          verification_checked_at: string | null
          verification_failure_reason: string | null
          verification_reference: string | null
          verification_status: Database["public"]["Enums"]["verification_status"]
          website_url: string | null
          year_founded: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "businesses"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_my_memberships: {
        Args: never
        Returns: {
          business_id: string
          membership_role: Database["public"]["Enums"]["membership_role"]
        }[]
      }
      has_active_membership: {
        Args: { p_at?: string; p_user_id: string }
        Returns: boolean
      }
      has_event_pass: {
        Args: { p_at?: string; p_event_id: string; p_user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_business_member: {
        Args: { _business_id: string; _user_id: string }
        Returns: boolean
      }
      is_business_owner: {
        Args: { _business_id: string; _user_id: string }
        Returns: boolean
      }
      is_chat_banned: {
        Args: { _event_id: string; _user_id: string }
        Returns: boolean
      }
      is_verified_vendor: { Args: { _user_id: string }; Returns: boolean }
      lender_product_types_ok: { Args: { value: Json }; Returns: boolean }
      lender_states_ok: { Args: { value: Json }; Returns: boolean }
      list_business_credentials: {
        Args: { p_business_id: string }
        Returns: {
          business_id: string
          created_at: string
          credential_type: string
          document_path: string | null
          expires_at: string | null
          id: string
          identifier: string | null
          issued_at: string | null
          issuing_authority: string | null
          private_notes: string | null
          public_display_approved: boolean
          review_status: Database["public"]["Enums"]["credential_review_status"]
          reviewed_at: string | null
          reviewed_by: string | null
          submitted_by: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "business_credentials"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_business_members: {
        Args: { p_business_id: string }
        Returns: {
          business_id: string
          created_at: string
          id: string
          invitation_status: Database["public"]["Enums"]["invitation_status"]
          invited_by: string | null
          joined_at: string | null
          membership_role: Database["public"]["Enums"]["membership_role"]
          permissions: Json
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "business_members"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_property_inquiries: {
        Args: { p_business_id: string }
        Returns: {
          business_id: string
          contact_email: string
          contact_name: string
          contact_phone: string | null
          created_at: string
          from_user_id: string | null
          id: string
          message: string
          property_id: string
          status: Database["public"]["Enums"]["inquiry_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "property_inquiries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_service_inquiries: {
        Args: { p_business_id: string }
        Returns: {
          business_id: string
          contact_email: string
          contact_name: string
          contact_phone: string | null
          created_at: string
          from_user_id: string | null
          id: string
          message: string
          service_id: string
          status: Database["public"]["Enums"]["inquiry_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "service_inquiries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      private_consume_provider_oauth_state: {
        Args: { p_now?: string; p_provider: string; p_state_sha256: string }
        Returns: string
      }
      private_create_provider_oauth_state: {
        Args: {
          p_expires_at: string
          p_provider: string
          p_redirect_uri: string
          p_state_sha256: string
        }
        Returns: undefined
      }
      private_get_provider_connection: {
        Args: { p_environment: string; p_provider: string }
        Returns: {
          access_token_ciphertext: string
          access_token_expires_at: string
          access_token_iv: string
          refresh_token_ciphertext: string
          refresh_token_iv: string
        }[]
      }
      private_upsert_provider_connection: {
        Args: {
          p_access_token_ciphertext: string
          p_access_token_expires_at: string
          p_access_token_iv: string
          p_environment: string
          p_granted_scopes: string[]
          p_provider: string
          p_refresh_token_ciphertext: string
          p_refresh_token_expires_at: string
          p_refresh_token_iv: string
          p_secret_reference: string
        }
        Returns: undefined
      }
      property_api_reserve_rate_limit: {
        Args: { p_key_id: string; p_limit: number; p_window_started_at: number }
        Returns: {
          allowed: boolean
          request_count: number
        }[]
      }
      review_business: {
        Args: {
          p_business_id: string
          p_decision: string
          p_note?: string
          p_request_id?: string
        }
        Returns: {
          address_city: string | null
          address_country: string | null
          address_state: string | null
          cover_path: string | null
          created_at: string
          created_by: string | null
          description: string | null
          display_name: string
          employee_count_range: string | null
          entity_type: string | null
          formation_state: string | null
          handle: string | null
          headline: string | null
          id: string
          legal_name: string
          logo_path: string | null
          primary_industry: string | null
          profile_status: Database["public"]["Enums"]["profile_status"]
          public_email: string | null
          public_phone: string | null
          public_profile_enabled: boolean
          published_at: string | null
          service_areas: string[]
          slug: string
          tax_id_last4: string | null
          updated_at: string
          verification_checked_at: string | null
          verification_failure_reason: string | null
          verification_reference: string | null
          verification_status: Database["public"]["Enums"]["verification_status"]
          website_url: string | null
          year_founded: number | null
        }
        SetofOptions: {
          from: "*"
          to: "businesses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_business_credential: {
        Args: {
          p_credential_id: string
          p_decision: string
          p_note?: string
          p_request_id?: string
        }
        Returns: {
          business_id: string
          created_at: string
          credential_type: string
          document_path: string | null
          expires_at: string | null
          id: string
          identifier: string | null
          issued_at: string | null
          issuing_authority: string | null
          private_notes: string | null
          public_display_approved: boolean
          review_status: Database["public"]["Enums"]["credential_review_status"]
          reviewed_at: string | null
          reviewed_by: string | null
          submitted_by: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "business_credentials"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_property: {
        Args: {
          p_decision: string
          p_note?: string
          p_property_id: string
          p_request_id?: string
        }
        Returns: {
          address_city: string | null
          address_country: string | null
          address_line1: string | null
          address_state: string | null
          archived_at: string | null
          area_sqft: number | null
          bathrooms: number | null
          bedrooms: number | null
          business_id: string
          cover_path: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          id: string
          latitude: number | null
          longitude: number | null
          postal_code: string | null
          price_minor: number | null
          property_type: string | null
          published_at: string | null
          slug: string
          status: Database["public"]["Enums"]["property_status"]
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "properties"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_service: {
        Args: {
          p_decision: string
          p_note?: string
          p_request_id?: string
          p_service_id: string
        }
        Returns: {
          business_id: string
          category: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          id: string
          image_path: string | null
          name: string
          price_minor: number | null
          price_note: string | null
          published_at: string | null
          service_areas: string[]
          slug: string
          status: Database["public"]["Enums"]["service_status"]
          summary: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "services"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_business_credential: {
        Args: {
          p_business_id: string
          p_credential_type: string
          p_expires_at?: string
          p_identifier?: string
          p_issuing_authority?: string
        }
        Returns: string
      }
      submit_lender_intake: {
        Args: {
          p_business_name: string
          p_capital_available: string
          p_capital_source: string
          p_closing_days: number
          p_content_risk: string
          p_email: string
          p_full_name: string
          p_lender_type: string
          p_max_loan_amount: number
          p_min_loan_amount: number
          p_negotiable: boolean
          p_network_capacity: number
          p_nmls_id: string
          p_notes: string
          p_phone: string
          p_points_max_bps: number
          p_points_min_bps: number
          p_product_types: Json
          p_rate_max_bps: number
          p_rate_min_bps: number
          p_role: string
          p_states: Json
          p_submitted_ip_hash: string
          p_term_max_months: number
          p_term_min_months: number
          p_user_agent_hash: string
          p_website: string
        }
        Returns: string
      }
      update_inquiry_status: {
        Args: {
          p_id: string
          p_status: Database["public"]["Enums"]["inquiry_status"]
          p_table: string
        }
        Returns: undefined
      }
    }
    Enums: {
      account_type: "individual" | "business"
      app_role:
        | "member"
        | "business_owner"
        | "business_staff"
        | "moderator"
        | "admin"
      chat_badge:
        | "accountabul_member"
        | "event_guest"
        | "moderator"
        | "paid_guest"
        | "external"
      chat_source:
        | "accountabul"
        | "paid_guest"
        | "restream"
        | "youtube"
        | "facebook"
        | "linkedin"
        | "twitch"
        | "x"
        | "kick"
      community_access_policy:
        | "signed_in"
        | "verified_vendor"
        | "role_allowlist"
        | "user_allowlist"
      community_badge: "member" | "vendor" | "moderator" | "admin"
      community_flag_category:
        | "spam"
        | "harassment"
        | "hate"
        | "sexual"
        | "violence"
        | "self_harm"
        | "illegal"
        | "malicious_link"
        | "flooding"
        | "other"
      community_flag_source: "member_report" | "automated"
      community_flag_status: "open" | "actioned" | "dismissed"
      community_grant_kind: "role" | "user"
      community_moderation_action_kind:
        | "message_hidden"
        | "message_unhidden"
        | "message_deleted"
        | "message_restored"
        | "flags_dismissed"
        | "user_muted"
        | "user_removed_from_room"
        | "user_banned"
        | "restriction_lifted"
      community_moderation_actor: "operator" | "system"
      community_restriction_kind: "mute" | "room_removal" | "ban"
      credential_review_status: "pending" | "approved" | "rejected"
      event_access_mode: "public" | "subscriber" | "subscriber_or_pass"
      event_access_type: "watch" | "watch_and_chat"
      event_pass_status:
        | "pending"
        | "active"
        | "refunded"
        | "revoked"
        | "expired"
      event_status:
        | "scheduled"
        | "live"
        | "ended"
        | "canceled"
        | "replay_available"
      inquiry_status:
        | "new"
        | "contacted"
        | "qualified"
        | "won"
        | "lost"
        | "spam"
      invitation_status: "invited" | "active" | "revoked"
      live_alert_channel: "in_app" | "email" | "sms"
      live_alert_kind: "scheduled" | "live"
      live_alert_status: "queued" | "sent" | "failed" | "suppressed"
      membership_role:
        | "owner"
        | "manager"
        | "listing_manager"
        | "lead_manager"
        | "viewer"
      membership_subscription_status:
        | "incomplete"
        | "incomplete_expired"
        | "trialing"
        | "active"
        | "past_due"
        | "canceled"
        | "unpaid"
        | "paused"
      moderation_status: "pending" | "approved" | "quarantined" | "rejected"
      onboarding_status:
        | "new"
        | "profile_complete"
        | "business_started"
        | "complete"
      paid_comment_status:
        | "screening"
        | "awaiting_moderator"
        | "approved"
        | "checkout_created"
        | "paid"
        | "published"
        | "rejected"
        | "payment_failed"
        | "refunded"
        | "expired"
      payment_kind: "membership" | "event_pass" | "paid_comment" | "tip"
      payment_status:
        | "created"
        | "requires_action"
        | "processing"
        | "paid"
        | "failed"
        | "refunded"
        | "partially_refunded"
        | "canceled"
      profile_status:
        | "draft"
        | "pending_review"
        | "published"
        | "rejected"
        | "suspended"
        | "archived"
      property_status:
        | "draft"
        | "pending_review"
        | "published"
        | "rejected"
        | "archived"
      provider_health_status: "healthy" | "degraded" | "offline" | "unknown"
      service_status:
        | "draft"
        | "pending_review"
        | "published"
        | "rejected"
        | "archived"
      speaker_request_status:
        | "pending"
        | "approved"
        | "rejected"
        | "link_issued"
        | "expired"
        | "revoked"
      tip_status: "created" | "processing" | "paid" | "failed" | "refunded"
      verification_status:
        | "unverified"
        | "pending"
        | "in_review"
        | "verified"
        | "rejected"
        | "expired"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_type: ["individual", "business"],
      app_role: [
        "member",
        "business_owner",
        "business_staff",
        "moderator",
        "admin",
      ],
      chat_badge: [
        "accountabul_member",
        "event_guest",
        "moderator",
        "paid_guest",
        "external",
      ],
      chat_source: [
        "accountabul",
        "paid_guest",
        "restream",
        "youtube",
        "facebook",
        "linkedin",
        "twitch",
        "x",
        "kick",
      ],
      community_access_policy: [
        "signed_in",
        "verified_vendor",
        "role_allowlist",
        "user_allowlist",
      ],
      community_badge: ["member", "vendor", "moderator", "admin"],
      community_flag_category: [
        "spam",
        "harassment",
        "hate",
        "sexual",
        "violence",
        "self_harm",
        "illegal",
        "malicious_link",
        "flooding",
        "other",
      ],
      community_flag_source: ["member_report", "automated"],
      community_flag_status: ["open", "actioned", "dismissed"],
      community_grant_kind: ["role", "user"],
      community_moderation_action_kind: [
        "message_hidden",
        "message_unhidden",
        "message_deleted",
        "message_restored",
        "flags_dismissed",
        "user_muted",
        "user_removed_from_room",
        "user_banned",
        "restriction_lifted",
      ],
      community_moderation_actor: ["operator", "system"],
      community_restriction_kind: ["mute", "room_removal", "ban"],
      credential_review_status: ["pending", "approved", "rejected"],
      event_access_mode: ["public", "subscriber", "subscriber_or_pass"],
      event_access_type: ["watch", "watch_and_chat"],
      event_pass_status: [
        "pending",
        "active",
        "refunded",
        "revoked",
        "expired",
      ],
      event_status: [
        "scheduled",
        "live",
        "ended",
        "canceled",
        "replay_available",
      ],
      inquiry_status: ["new", "contacted", "qualified", "won", "lost", "spam"],
      invitation_status: ["invited", "active", "revoked"],
      live_alert_channel: ["in_app", "email", "sms"],
      live_alert_kind: ["scheduled", "live"],
      live_alert_status: ["queued", "sent", "failed", "suppressed"],
      membership_role: [
        "owner",
        "manager",
        "listing_manager",
        "lead_manager",
        "viewer",
      ],
      membership_subscription_status: [
        "incomplete",
        "incomplete_expired",
        "trialing",
        "active",
        "past_due",
        "canceled",
        "unpaid",
        "paused",
      ],
      moderation_status: ["pending", "approved", "quarantined", "rejected"],
      onboarding_status: [
        "new",
        "profile_complete",
        "business_started",
        "complete",
      ],
      paid_comment_status: [
        "screening",
        "awaiting_moderator",
        "approved",
        "checkout_created",
        "paid",
        "published",
        "rejected",
        "payment_failed",
        "refunded",
        "expired",
      ],
      payment_kind: ["membership", "event_pass", "paid_comment", "tip"],
      payment_status: [
        "created",
        "requires_action",
        "processing",
        "paid",
        "failed",
        "refunded",
        "partially_refunded",
        "canceled",
      ],
      profile_status: [
        "draft",
        "pending_review",
        "published",
        "rejected",
        "suspended",
        "archived",
      ],
      property_status: [
        "draft",
        "pending_review",
        "published",
        "rejected",
        "archived",
      ],
      provider_health_status: ["healthy", "degraded", "offline", "unknown"],
      service_status: [
        "draft",
        "pending_review",
        "published",
        "rejected",
        "archived",
      ],
      speaker_request_status: [
        "pending",
        "approved",
        "rejected",
        "link_issued",
        "expired",
        "revoked",
      ],
      tip_status: ["created", "processing", "paid", "failed", "refunded"],
      verification_status: [
        "unverified",
        "pending",
        "in_review",
        "verified",
        "rejected",
        "expired",
      ],
    },
  },
} as const
