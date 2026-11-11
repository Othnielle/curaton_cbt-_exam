const crypto = require("crypto");
const { neon } = require("@neondatabase/serverless");

const DB = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = neon(DB);
const SECRET = process.env.SESSION_SECRET || DB;
const UUID = /^[0-9a-f-]{36}$/i;

const sha = (x) => crypto.createHash("sha256").update(String(x)).digest();
const eq = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const hash = (p, s = crypto.randomBytes(16).toString("hex")) => s + ":" + crypto.scryptSync(String(p), s, 32).toString("hex");
const verify = (p, h) => !!h && eq(hash(p, h.split(":")[0]), h);
const mac = (p) => crypto.createHmac("sha256", SECRET).update(p).digest("base64url");
const sign = (o) => { const p = Buffer.from(JSON.stringify(o)).toString("base64url"); return p + "." + mac(p); };
const read = (t) => {
  const [p, m] = String(t || "").split(".");
  if (!p || !m || !eq(m, mac(p))) return null;
  try { const o = JSON.parse(Buffer.from(p, "base64url").toString()); return o.x > Date.now() ? o : null; } catch { return null; }
};
const cookie = (res, v, age) => res.setHeader("Set-Cookie", `cbt=${v}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${age}`);
const session = (res, email, pw) => cookie(res, sign({ e: email.toLowerCase(), v: pw.slice(-12), x: Date.now() + 12 * 36e5 }), 43200);
const who = async (req) => {
  const m = /(?:^|;\s*)cbt=([^;]+)/.exec(req.headers.cookie || "");
  const t = m && read(m[1]);
  if (!t) return null;
  const [ad] = await sql`select * from admins where lower(email) = ${t.e}`;
  return ad && ad.pw && t.v === ad.pw.slice(-12) ? ad : null;
};
const cfg = async () => (await sql`select * from settings where id = 1`)[0] || { open: false, code: "", minutes: 15 };
const fail = (res, c, e) => res.status(c).json({ error: e });

module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "POST only");
  const a = req.query.a, b = req.body || {};
  try {
    /* ---------- public: students ---------- */
    if (a === "info") { const s = await cfg(); return res.json({ open: s.open, minutes: s.minutes }); }

    if (a === "start") {
      const s = await cfg();
      if (!s.open) return fail(res, 403, "The exam is not open yet. Ask your teacher.");
      if (String(b.code || "").trim().toLowerCase() !== s.code.trim().toLowerCase()) return fail(res, 403, "Wrong exam code. Check with your teacher.");
      const name = String(b.name || "").trim().slice(0, 80);
      if (name.length < 2) return fail(res, 400, "Please enter your name.");
      const cls = String(b.cls || "").trim().slice(0, 40);
      const [r] = await sql`insert into attempts (name, cls, last_seen) values (${name}, ${cls}, now()) returning id`;
      return res.json({ id: r.id, minutes: s.minutes });
    }

    if (a === "ping") {
      if (UUID.test(String(b.id))) {
        const n = Math.max(0, Math.min(99, Math.round(+b.answered) || 0));
        await sql`update attempts set last_seen = now(), answered = ${n} where id = ${b.id} and submitted_at is null`;
      }
      return res.json({ ok: true });
    }

    if (a === "submit") {
      if (!UUID.test(String(b.id))) return fail(res, 400, "Bad attempt id");
      const [r] = await sql`select * from attempts where id = ${b.id}`;
      if (!r) return fail(res, 404, "Attempt not found");
      if (r.submitted_at) return res.json({ ok: true });
      const M = (await cfg()).minutes;
      const d = Array.isArray(b.detail) ? b.detail.slice(0, 50).map((x) => [String(x[0]).slice(0, 30), x[1] ? 1 : 0]) : [];
      const total = d.length || Math.max(1, Math.min(50, Math.round(+b.total) || 1));
      const score = d.length ? d.reduce((n, x) => n + x[1], 0) : Math.max(0, Math.min(total, Math.round(+b.score) || 0));
      const used = Math.round((Date.now() - new Date(r.started_at)) / 1000);
      await sql`update attempts set submitted_at = now(), score = ${score}, total = ${total}, pct = ${Math.round((score / total) * 100)},
        used = ${Math.min(used, M * 60)}, auto = ${!!b.auto}, late = ${used > M * 60 + 60}, answered = ${total},
        detail = ${d.length ? JSON.stringify(d) : null}::jsonb where id = ${r.id}`;
      return res.json({ ok: true });
    }

    /* ---------- admin auth ---------- */
    if (a === "login") {
      const em = String(b.email || "").trim().toLowerCase(), pw = String(b.password || "");
      const [ad] = await sql`select * from admins where lower(email) = ${em}`;
      if (!ad) return fail(res, 401, "Wrong email or password.");
      if (ad.locked_until && new Date(ad.locked_until) > new Date()) return fail(res, 429, "Too many attempts. Try again in 15 minutes.");
      let ok = false;
      if (!ad.pw) { // first login: the setup password comes from the ADMIN_PASSWORD environment variable
        const seed = process.env.ADMIN_PASSWORD || "";
        if (seed && eq(pw, seed)) { ad.pw = hash(pw); ok = true; await sql`update admins set pw = ${ad.pw} where id = ${ad.id}`; }
      } else ok = verify(pw, ad.pw);
      if (!ok) {
        const f = ad.failed + 1;
        await sql`update admins set failed = ${f >= 5 ? 0 : f}, locked_until = ${f >= 5 ? new Date(Date.now() + 9e5).toISOString() : null} where id = ${ad.id}`;
        return fail(res, 401, "Wrong email or password.");
      }
      await sql`update admins set failed = 0, locked_until = null where id = ${ad.id}`;
      session(res, ad.email, ad.pw);
      return res.json({ email: ad.email });
    }
    if (a === "logout") { cookie(res, "", 0); return res.json({ ok: true }); }

    /* ---------- admin only ---------- */
    const ad = await who(req);
    if (!ad) return fail(res, 401, "Please sign in.");

    if (a === "dash") {
      const rows = await sql`select id, name, cls, started_at, last_seen, answered, submitted_at, score, total, pct, used, auto, late, detail
        from attempts order by started_at desc limit 1000`;
      return res.json({ s: await cfg(), rows, now: Date.now(), email: ad.email });
    }
    if (a === "settings") {
      const code = String(b.code || "").trim().slice(0, 40);
      const minutes = Math.max(1, Math.min(180, Math.round(+b.minutes) || 15));
      if (b.open && !code) return fail(res, 400, "Set an exam code before opening the exam.");
      await sql`update settings set open = ${!!b.open}, code = ${code}, minutes = ${minutes} where id = 1`;
      return res.json({ s: await cfg() });
    }
    if (a === "account") {
      if (!verify(String(b.current || ""), ad.pw)) return fail(res, 403, "Current password is wrong.");
      const email = String(b.email || ad.email).trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) return fail(res, 400, "Enter a valid email.");
      let pw = ad.pw;
      if (b.password) {
        if (String(b.password).length < 8) return fail(res, 400, "New password must be at least 8 characters.");
        pw = hash(b.password);
      }
      try { await sql`update admins set email = ${email}, pw = ${pw} where id = ${ad.id}`; }
      catch { return fail(res, 409, "That email is already in use."); }
      session(res, email, pw);
      return res.json({ ok: true, email });
    }
    if (a === "delete") {
      if (!UUID.test(String(b.id))) return fail(res, 400, "Bad id");
      await sql`delete from attempts where id = ${b.id}`;
      return res.json({ ok: true });
    }
    if (a === "purge") {
      if (b.confirm !== "DELETE") return fail(res, 400, "Type DELETE to confirm.");
      await sql`delete from attempts`;
      return res.json({ ok: true });
    }
    return fail(res, 404, "Unknown action");
  } catch (e) {
    console.error(e);
    return fail(res, 500, "Server error. Please try again.");
  }
};
