/* Disaster Lens – connection settings.
 *
 * These two values come from Supabase (Project settings -> API) and are SAFE to publish:
 * the anon key is public by design and can only do what the database rules (supabase/schema.sql) allow.
 * NEVER put the "service_role" key (or any "secret" key) in this file or anywhere in the website.
 *
 * Leave both empty to run the site on its own, with data kept only in each browser (useful for trying it out).
 */
window.DL_CONFIG = {
  supabaseUrl: 'https://uytcpapwkyrlwmvpvtik.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5dGNwYXB3a3lybHdtdnB2dGlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExMjE4MzEsImV4cCI6MjEwNjY5NzgzMX0.EcKzX1PkPBCJl56DjSKYXqrNTyuYCeAjbSRtfbfnLH8'
};
