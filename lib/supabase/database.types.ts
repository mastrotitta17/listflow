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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      categories: {
        Row: {
          created_at: string
          id: string
          parent_id: string | null
          slug: string
          title_en: string
          title_tr: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          parent_id?: string | null
          slug: string
          title_en: string
          title_tr: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          parent_id?: string | null
          slug?: string
          title_en?: string
          title_tr?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      listing: {
        Row: {
          category: string | null
          client_id: string | null
          created_at: string
          date: string | null
          description: string | null
          etiket: string | null
          etsy_store_link: string | null
          id: string
          image_1_url: string | null
          image_2_url: string | null
          image_3_url: string | null
          key: string | null
          pinterest: string | null
          price: number
          quantity: number
          status: string
          tags: string[]
          title: string | null
          updated_at: string
          variations: Json
        }
        Insert: {
          category?: string | null
          client_id?: string | null
          created_at?: string
          date?: string | null
          description?: string | null
          etiket?: string | null
          etsy_store_link?: string | null
          id?: string
          image_1_url?: string | null
          image_2_url?: string | null
          image_3_url?: string | null
          key?: string | null
          pinterest?: string | null
          price?: number
          quantity?: number
          status?: string
          tags?: string[]
          title?: string | null
          updated_at?: string
          variations?: Json
        }
        Update: {
          category?: string | null
          client_id?: string | null
          created_at?: string
          date?: string | null
          description?: string | null
          etiket?: string | null
          etsy_store_link?: string | null
          id?: string
          image_1_url?: string | null
          image_2_url?: string | null
          image_3_url?: string | null
          key?: string | null
          pinterest?: string | null
          price?: number
          quantity?: number
          status?: string
          tags?: string[]
          title?: string | null
          updated_at?: string
          variations?: Json
        }
        Relationships: []
      }
      orders: {
        Row: {
          amount_usd: number
          category_name: string
          created_at: string
          id: string
          ioss: string | null
          label_number: string
          navlungo_error: string | null
          navlungo_last_synced_at: string | null
          navlungo_quote_reference: string | null
          navlungo_response: Json | null
          navlungo_search_id: string | null
          navlungo_shipment_id: string | null
          navlungo_shipment_reference: string | null
          navlungo_status: string | null
          navlungo_store_id: string | null
          navlungo_tracking_url: string | null
          note: string | null
          order_date: string
          payment_status: string
          product_link: string
          receiver_city: string | null
          receiver_country_code: string | null
          receiver_name: string | null
          receiver_phone: string | null
          receiver_postal_code: string | null
          receiver_state: string | null
          receiver_town: string | null
          shipping_address: string
          store_id: string | null
          sub_product_name: string
          updated_at: string
          user_id: string
          variant_name: string | null
        }
        Insert: {
          amount_usd?: number
          category_name: string
          created_at?: string
          id?: string
          ioss?: string | null
          label_number: string
          navlungo_error?: string | null
          navlungo_last_synced_at?: string | null
          navlungo_quote_reference?: string | null
          navlungo_response?: Json | null
          navlungo_search_id?: string | null
          navlungo_shipment_id?: string | null
          navlungo_shipment_reference?: string | null
          navlungo_status?: string | null
          navlungo_store_id?: string | null
          navlungo_tracking_url?: string | null
          note?: string | null
          order_date?: string
          payment_status?: string
          product_link: string
          receiver_city?: string | null
          receiver_country_code?: string | null
          receiver_name?: string | null
          receiver_phone?: string | null
          receiver_postal_code?: string | null
          receiver_state?: string | null
          receiver_town?: string | null
          shipping_address: string
          store_id?: string | null
          sub_product_name: string
          updated_at?: string
          user_id: string
          variant_name?: string | null
        }
        Update: {
          amount_usd?: number
          category_name?: string
          created_at?: string
          id?: string
          ioss?: string | null
          label_number?: string
          navlungo_error?: string | null
          navlungo_last_synced_at?: string | null
          navlungo_quote_reference?: string | null
          navlungo_response?: Json | null
          navlungo_search_id?: string | null
          navlungo_shipment_id?: string | null
          navlungo_shipment_reference?: string | null
          navlungo_status?: string | null
          navlungo_store_id?: string | null
          navlungo_tracking_url?: string | null
          note?: string | null
          order_date?: string
          payment_status?: string
          product_link?: string
          receiver_city?: string | null
          receiver_country_code?: string | null
          receiver_name?: string | null
          receiver_phone?: string | null
          receiver_postal_code?: string | null
          receiver_state?: string | null
          receiver_town?: string | null
          shipping_address?: string
          store_id?: string | null
          sub_product_name?: string
          updated_at?: string
          user_id?: string
          variant_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          id: string
          shop_id: string | null
          status: string
          stripe_invoice_id: string | null
          stripe_session_id: string | null
          stripe_subscription_id: string | null
          user_id: string | null
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          currency?: string
          id?: string
          shop_id?: string | null
          status?: string
          stripe_invoice_id?: string | null
          stripe_session_id?: string | null
          stripe_subscription_id?: string | null
          user_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          id?: string
          shop_id?: string | null
          status?: string
          stripe_invoice_id?: string | null
          stripe_session_id?: string | null
          stripe_subscription_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      products: {
        Row: {
          catalog_description: string | null
          catalog_youtube_url: string | null
          category_id: string | null
          cost: number
          created_at: string
          cut_percent: number
          id: string
          image_urls: string[]
          margin_percent: number
          net_profit: number
          sale_price: number
          shipping_cost: number
          stripe_price_id: string | null
          stripe_product_id: string | null
          title_en: string
          title_tr: string
          updated_at: string
          variations: Json
        }
        Insert: {
          catalog_description?: string | null
          catalog_youtube_url?: string | null
          category_id?: string | null
          cost?: number
          created_at?: string
          cut_percent?: number
          id?: string
          image_urls?: string[]
          margin_percent?: number
          net_profit?: number
          sale_price?: number
          shipping_cost?: number
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          title_en: string
          title_tr: string
          updated_at?: string
          variations?: Json
        }
        Update: {
          catalog_description?: string | null
          catalog_youtube_url?: string | null
          category_id?: string | null
          cost?: number
          created_at?: string
          cut_percent?: number
          id?: string
          image_urls?: string[]
          margin_percent?: number
          net_profit?: number
          sale_price?: number
          shipping_cost?: number
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          title_en?: string
          title_tr?: string
          updated_at?: string
          variations?: Json
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          is_subscriber: boolean
          locale: string
          phone: string | null
          role: string
          stripe_customer_id: string | null
          subscription_plan: string | null
          subscription_status: string | null
          subscription_updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          is_subscriber?: boolean
          locale?: string
          phone?: string | null
          role?: string
          stripe_customer_id?: string | null
          subscription_plan?: string | null
          subscription_status?: string | null
          subscription_updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          is_subscriber?: boolean
          locale?: string
          phone?: string | null
          role?: string
          stripe_customer_id?: string | null
          subscription_plan?: string | null
          subscription_status?: string | null
          subscription_updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      scheduler_jobs: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          idempotency_key: string
          plan: string | null
          request_payload: Json | null
          response_payload: string | null
          response_status: number | null
          retry_count: number
          run_at: string
          status: string
          store_id: string | null
          subscription_id: string | null
          trigger_type: string
          updated_at: string
          user_id: string | null
          webhook_config_id: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          idempotency_key: string
          plan?: string | null
          request_payload?: Json | null
          response_payload?: string | null
          response_status?: number | null
          retry_count?: number
          run_at?: string
          status?: string
          store_id?: string | null
          subscription_id?: string | null
          trigger_type?: string
          updated_at?: string
          user_id?: string | null
          webhook_config_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          idempotency_key?: string
          plan?: string | null
          request_payload?: Json | null
          response_payload?: string | null
          response_status?: number | null
          retry_count?: number
          run_at?: string
          status?: string
          store_id?: string | null
          subscription_id?: string | null
          trigger_type?: string
          updated_at?: string
          user_id?: string | null
          webhook_config_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduler_jobs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduler_jobs_webhook_config_id_fkey"
            columns: ["webhook_config_id"]
            isOneToOne: false
            referencedRelation: "webhook_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      store_automation_transitions: {
        Row: {
          created_at: string
          created_by: string | null
          from_webhook_config_id: string | null
          id: string
          month_index: number
          status: string
          store_id: string
          subscription_id: string | null
          to_webhook_config_id: string | null
          trigger_response_body: string | null
          trigger_response_status: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          from_webhook_config_id?: string | null
          id?: string
          month_index?: number
          status?: string
          store_id: string
          subscription_id?: string | null
          to_webhook_config_id?: string | null
          trigger_response_body?: string | null
          trigger_response_status?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          from_webhook_config_id?: string | null
          id?: string
          month_index?: number
          status?: string
          store_id?: string
          subscription_id?: string | null
          to_webhook_config_id?: string | null
          trigger_response_body?: string | null
          trigger_response_status?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "store_automation_transitions_from_webhook_config_id_fkey"
            columns: ["from_webhook_config_id"]
            isOneToOne: false
            referencedRelation: "webhook_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_automation_transitions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_automation_transitions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_automation_transitions_to_webhook_config_id_fkey"
            columns: ["to_webhook_config_id"]
            isOneToOne: false
            referencedRelation: "webhook_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          active_webhook_config_id: string | null
          automation_updated_at: string | null
          automation_updated_by: string | null
          category: string | null
          created_at: string
          id: string
          navlungo_store_id: string | null
          phone: string | null
          price_cents: number
          product_id: string | null
          status: string
          store_name: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active_webhook_config_id?: string | null
          automation_updated_at?: string | null
          automation_updated_by?: string | null
          category?: string | null
          created_at?: string
          id?: string
          navlungo_store_id?: string | null
          phone?: string | null
          price_cents?: number
          product_id?: string | null
          status?: string
          store_name: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active_webhook_config_id?: string | null
          automation_updated_at?: string | null
          automation_updated_by?: string | null
          category?: string | null
          created_at?: string
          id?: string
          navlungo_store_id?: string | null
          phone?: string | null
          price_cents?: number
          product_id?: string | null
          status?: string
          store_name?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stores_active_webhook_config_id_fkey"
            columns: ["active_webhook_config_id"]
            isOneToOne: false
            referencedRelation: "webhook_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stores_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_event_logs: {
        Row: {
          event_type: string
          id: string
          payload: Json
          processed_at: string
          stripe_event_id: string
          stripe_mode: string
        }
        Insert: {
          event_type: string
          id?: string
          payload: Json
          processed_at?: string
          stripe_event_id: string
          stripe_mode?: string
        }
        Update: {
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string
          stripe_event_id?: string
          stripe_mode?: string
        }
        Relationships: []
      }
      stripe_plan_prices: {
        Row: {
          active: boolean
          amount_cents: number
          created_at: string
          currency: string
          id: string
          interval: string
          plan: string
          stripe_mode: string
          stripe_price_id: string
          stripe_product_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          amount_cents: number
          created_at?: string
          currency?: string
          id?: string
          interval: string
          plan: string
          stripe_mode?: string
          stripe_price_id: string
          stripe_product_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          amount_cents?: number
          created_at?: string
          currency?: string
          id?: string
          interval?: string
          plan?: string
          stripe_mode?: string
          stripe_price_id?: string
          stripe_product_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          id: string
          plan: string
          shop_id: string | null
          status: string
          store_id: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          plan?: string
          shop_id?: string | null
          status?: string
          store_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          plan?: string
          shop_id?: string | null
          status?: string
          store_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_configs: {
        Row: {
          created_at: string
          description: string | null
          enabled: boolean
          headers: Json
          id: string
          method: string
          name: string
          product_id: string | null
          scope: string
          target_url: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          headers?: Json
          id?: string
          method?: string
          name: string
          product_id?: string | null
          scope?: string
          target_url: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          headers?: Json
          id?: string
          method?: string
          name?: string
          product_id?: string | null
          scope?: string
          target_url?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_configs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_logs: {
        Row: {
          created_at: string
          created_by: string | null
          duration_ms: number | null
          id: string
          request_body: Json | null
          request_headers: Json | null
          request_method: string | null
          request_url: string | null
          response_body: string | null
          response_status: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          duration_ms?: number | null
          id?: string
          request_body?: Json | null
          request_headers?: Json | null
          request_method?: string | null
          request_url?: string | null
          response_body?: string | null
          response_status?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          duration_ms?: number | null
          id?: string
          request_body?: Json | null
          request_headers?: Json | null
          request_method?: string | null
          request_url?: string | null
          response_body?: string | null
          response_status?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: { uid: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
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
