export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      profiles: {
        Row: {
          avatar_path: string | null
          banned_reason: string | null
          comment_count: number
          created_at: string
          email_hash: string | null
          handle: string | null
          handle_changed_at: string | null
          id: string
          is_banned: boolean
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          banned_reason?: string | null
          comment_count?: number
          created_at?: string
          email_hash?: string | null
          handle?: string | null
          handle_changed_at?: string | null
          id: string
          is_banned?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          banned_reason?: string | null
          comment_count?: number
          created_at?: string
          email_hash?: string | null
          handle?: string | null
          handle_changed_at?: string | null
          id?: string
          is_banned?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      project_downloads: {
        Row: {
          created_at: string
          file_id: string
          id: string
          ip_hash: string
          project_id: string
          ua_hash: string
        }
        Insert: {
          created_at?: string
          file_id: string
          id?: string
          ip_hash: string
          project_id: string
          ua_hash: string
        }
        Update: {
          created_at?: string
          file_id?: string
          id?: string
          ip_hash?: string
          project_id?: string
          ua_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_downloads_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "project_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_downloads_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_downloads_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      project_files: {
        Row: {
          created_at: string
          download_count: number
          filename: string
          id: string
          primary: boolean
          sha512: string | null
          size_bytes: number
          storage_path: string | null
          updated_at: string
          url: string | null
          version_id: string
        }
        Insert: {
          created_at?: string
          download_count?: number
          filename: string
          id?: string
          primary?: boolean
          sha512?: string | null
          size_bytes: number
          storage_path?: string | null
          updated_at?: string
          url?: string | null
          version_id: string
        }
        Update: {
          created_at?: string
          download_count?: number
          filename?: string
          id?: string
          primary?: boolean
          sha512?: string | null
          size_bytes?: number
          storage_path?: string | null
          updated_at?: string
          url?: string | null
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_files_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "project_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      project_links: {
        Row: {
          created_at: string
          downloads: number
          external_id: string
          platform: Database["public"]["Enums"]["link_platform"]
          project_id: string
          synced_at: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          downloads?: number
          external_id: string
          platform: Database["public"]["Enums"]["link_platform"]
          project_id: string
          synced_at: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          downloads?: number
          external_id?: string
          platform?: Database["public"]["Enums"]["link_platform"]
          project_id?: string
          synced_at?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      project_overrides: {
        Row: {
          comments_enabled: boolean
          created_at: string
          description_override: string | null
          extra_gallery: Json
          featured: boolean
          featured_order: number | null
          hidden: boolean
          notes_md: string | null
          project_id: string
          title_override: string | null
          updated_at: string
        }
        Insert: {
          comments_enabled?: boolean
          created_at?: string
          description_override?: string | null
          extra_gallery?: Json
          featured?: boolean
          featured_order?: number | null
          hidden?: boolean
          notes_md?: string | null
          project_id: string
          title_override?: string | null
          updated_at?: string
        }
        Update: {
          comments_enabled?: boolean
          created_at?: string
          description_override?: string | null
          extra_gallery?: Json
          featured?: boolean
          featured_order?: number | null
          hidden?: boolean
          notes_md?: string | null
          project_id?: string
          title_override?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_overrides_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_overrides_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      project_versions: {
        Row: {
          changelog_md: string | null
          created_at: string
          date_published: string
          downloads: number
          external_id: string | null
          game_versions: string[]
          id: string
          loaders: string[]
          name: string | null
          project_id: string
          updated_at: string
          version_number: string
          version_type: Database["public"]["Enums"]["version_type"]
        }
        Insert: {
          changelog_md?: string | null
          created_at?: string
          date_published: string
          downloads?: number
          external_id?: string | null
          game_versions: string[]
          id?: string
          loaders: string[]
          name?: string | null
          project_id: string
          updated_at?: string
          version_number: string
          version_type: Database["public"]["Enums"]["version_type"]
        }
        Update: {
          changelog_md?: string | null
          created_at?: string
          date_published?: string
          downloads?: number
          external_id?: string | null
          game_versions?: string[]
          id?: string
          loaders?: string[]
          name?: string | null
          project_id?: string
          updated_at?: string
          version_number?: string
          version_type?: Database["public"]["Enums"]["version_type"]
        }
        Relationships: [
          {
            foreignKeyName: "project_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          body_md: string
          categories: string[]
          created_at: string
          description: string
          discord_url: string | null
          downloads_curseforge: number
          downloads_direct: number
          downloads_modrinth: number
          external_id: string | null
          external_updated_at: string | null
          followers: number
          gallery: Json
          game_versions: string[]
          icon_url: string | null
          id: string
          issues_url: string | null
          license: string | null
          loaders: string[]
          project_type: Database["public"]["Enums"]["project_type"]
          published_at: string | null
          search: unknown
          slug: string
          source: Database["public"]["Enums"]["project_source"]
          source_url: string | null
          status: Database["public"]["Enums"]["project_status"]
          synced_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          body_md: string
          categories: string[]
          created_at?: string
          description: string
          discord_url?: string | null
          downloads_curseforge?: number
          downloads_direct?: number
          downloads_modrinth?: number
          external_id?: string | null
          external_updated_at?: string | null
          followers?: number
          gallery?: Json
          game_versions: string[]
          icon_url?: string | null
          id?: string
          issues_url?: string | null
          license?: string | null
          loaders: string[]
          project_type: Database["public"]["Enums"]["project_type"]
          published_at?: string | null
          search?: unknown
          slug: string
          source: Database["public"]["Enums"]["project_source"]
          source_url?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          synced_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          body_md?: string
          categories?: string[]
          created_at?: string
          description?: string
          discord_url?: string | null
          downloads_curseforge?: number
          downloads_direct?: number
          downloads_modrinth?: number
          external_id?: string | null
          external_updated_at?: string | null
          followers?: number
          gallery?: Json
          game_versions?: string[]
          icon_url?: string | null
          id?: string
          issues_url?: string | null
          license?: string | null
          loaders?: string[]
          project_type?: Database["public"]["Enums"]["project_type"]
          published_at?: string | null
          search?: unknown
          slug?: string
          source?: Database["public"]["Enums"]["project_source"]
          source_url?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          synced_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      rate_limit_hits: {
        Row: {
          key: string
          scope: string
          ts: string
        }
        Insert: {
          key: string
          scope: string
          ts?: string
        }
        Update: {
          key?: string
          scope?: string
          ts?: string
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          admin_notify_emails: string[]
          announcement_md: string | null
          comments_closed_default: boolean
          created_at: string
          discord_webhook_url: string | null
          id: number
          kofi_page: string | null
          moderation_mode: Database["public"]["Enums"]["moderation_mode"]
          owner_profile_id: string | null
          updated_at: string
        }
        Insert: {
          admin_notify_emails?: string[]
          announcement_md?: string | null
          comments_closed_default?: boolean
          created_at?: string
          discord_webhook_url?: string | null
          id: number
          kofi_page?: string | null
          moderation_mode?: Database["public"]["Enums"]["moderation_mode"]
          owner_profile_id?: string | null
          updated_at?: string
        }
        Update: {
          admin_notify_emails?: string[]
          announcement_md?: string | null
          comments_closed_default?: boolean
          created_at?: string
          discord_webhook_url?: string | null
          id?: number
          kofi_page?: string | null
          moderation_mode?: Database["public"]["Enums"]["moderation_mode"]
          owner_profile_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_settings_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_settings_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_runs: {
        Row: {
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          items: number | null
          ok: boolean | null
          source: string
          started_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          items?: number | null
          ok?: boolean | null
          source: string
          started_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          items?: number | null
          ok?: boolean | null
          source?: string
          started_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      projects_public: {
        Row: {
          body_md: string | null
          categories: string[] | null
          created_at: string | null
          description: string | null
          discord_url: string | null
          downloads_curseforge: number | null
          downloads_direct: number | null
          downloads_modrinth: number | null
          downloads_total: number | null
          external_id: string | null
          external_updated_at: string | null
          followers: number | null
          gallery: Json | null
          game_versions: string[] | null
          icon_url: string | null
          id: string | null
          issues_url: string | null
          license: string | null
          loaders: string[] | null
          project_type: Database["public"]["Enums"]["project_type"] | null
          published_at: string | null
          slug: string | null
          source: Database["public"]["Enums"]["project_source"] | null
          source_url: string | null
          synced_at: string | null
          title: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      public_profiles: {
        Row: {
          avatar_path: string | null
          handle: string | null
          id: string | null
          role: Database["public"]["Enums"]["user_role"] | null
        }
        Insert: {
          avatar_path?: string | null
          handle?: string | null
          id?: string | null
          role?: Database["public"]["Enums"]["user_role"] | null
        }
        Update: {
          avatar_path?: string | null
          handle?: string | null
          id?: string | null
          role?: Database["public"]["Enums"]["user_role"] | null
        }
        Relationships: []
      }
      site_settings_public: {
        Row: {
          comments_closed_default: boolean | null
          kofi_page: string | null
          moderation_mode: Database["public"]["Enums"]["moderation_mode"] | null
          owner_profile_id: string | null
        }
        Insert: {
          comments_closed_default?: boolean | null
          kofi_page?: string | null
          moderation_mode?:
            | Database["public"]["Enums"]["moderation_mode"]
            | null
          owner_profile_id?: string | null
        }
        Update: {
          comments_closed_default?: boolean | null
          kofi_page?: string | null
          moderation_mode?:
            | Database["public"]["Enums"]["moderation_mode"]
            | null
          owner_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_settings_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_settings_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      check_handle: { Args: { p_handle: string }; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      is_moderator: { Args: never; Returns: boolean }
      is_reserved_handle: { Args: { p_handle: string }; Returns: boolean }
      project_is_visible: { Args: { p_project_id: string }; Returns: boolean }
      purge_project_downloads: { Args: { p_days: number }; Returns: number }
      purge_rate_limit_hits: { Args: { p_days: number }; Returns: number }
      rate_limit_ok: {
        Args: {
          p_key: string
          p_max: number
          p_scope: string
          p_window: string
        }
        Returns: boolean
      }
      record_download: {
        Args: { p_file_id: string; p_ip_hash: string; p_ua_hash: string }
        Returns: undefined
      }
    }
    Enums: {
      link_platform: "modrinth" | "curseforge"
      moderation_mode: "auto" | "hold_first_time"
      project_source: "modrinth" | "odsens"
      project_status: "draft" | "published" | "hidden"
      project_type: "mod" | "datapack" | "resourcepack" | "plugin"
      user_role: "user" | "moderator" | "admin"
      version_type: "release" | "beta" | "alpha"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      link_platform: ["modrinth", "curseforge"],
      moderation_mode: ["auto", "hold_first_time"],
      project_source: ["modrinth", "odsens"],
      project_status: ["draft", "published", "hidden"],
      project_type: ["mod", "datapack", "resourcepack", "plugin"],
      user_role: ["user", "moderator", "admin"],
      version_type: ["release", "beta", "alpha"],
    },
  },
} as const

