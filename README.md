# Music Theory CBT: Vercel + Neon

Students take the exam at `/`. You manage everything at `/admin`.

## Set up (about 10 minutes)
1. Put this folder in a GitHub repo and import it in Vercel (Framework: Other, no build command).
2. In the Vercel project: Storage > Create Database > Neon. This creates the database and adds `DATABASE_URL` to the project for you.
3. Open the Neon SQL Editor (from the Neon integration page in Vercel, or console.neon.tech), paste `schema.sql` and run it.
   It seeds your login email: othnielchuks@gmail.com (edit that line first if you want a different one).
4. In Vercel > Settings > Environment Variables add `ADMIN_PASSWORD`: pick the password you want for your first sign-in.
   Optional: `SESSION_SECRET` (any long random text).
5. Redeploy (Deployments > Redeploy), then open `https://YOUR-SITE.vercel.app/admin`.
6. Sign in with the seeded email and your ADMIN_PASSWORD. Then go to Settings and change your email and password. After that the ADMIN_PASSWORD variable is no longer used.
7. Exam tab: generate a code, set the duration, switch the exam on. Give students the site link and the code. Switch it off when time is up.

## Dashboard tabs
Overview (scores, pass rate, topics students find hard), Live (who is taking the exam now and how far they are), Results (search, filter by class, export CSV, delete), Exam (open/close, code, duration), Settings (change login, delete all results).

Edit `school:` in the CFG line near the top of the script in `index.html` to rename the school.
