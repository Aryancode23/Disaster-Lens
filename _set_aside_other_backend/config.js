/* Disaster Lens – connection settings.
 *
 * Leave both values empty to run the site on its own (data stays in each browser: good for trying it out).
 * To go live, paste the two values from Supabase: Project settings -> API.
 *   supabaseUrl      looks like  https://abcdxyz.supabase.co
 *   supabaseAnonKey  the long "anon / public" key
 *
 * The anon key is MEANT to be public: it can only do what the database rules (row-level security) allow.
 * NEVER paste the "service_role" key here or anywhere in the website.
 */
window.DL_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: ''
};
