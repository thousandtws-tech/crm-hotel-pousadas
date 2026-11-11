-- Realtime delta para cms_site: edições de hero/SEO/FAQ notificam o site público na hora.
DROP TRIGGER IF EXISTS trg_delta_cms_site ON cms_site;
CREATE TRIGGER trg_delta_cms_site
    AFTER INSERT OR UPDATE OR DELETE ON cms_site
    FOR EACH ROW EXECUTE FUNCTION notify_delta();
