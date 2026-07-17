# Active work

- Complete the Google Auth Platform web-client form for project
  `jobkit-outreach-20260716`. Use
  `https://outreach-product.peacockery.studio` as the JavaScript origin and
  `https://outreach-product.peacockery.studio/api/auth/callback/google` as the
  redirect URI; add the Gmail compose and readonly scopes and the personal
  Gmail account as a test user.
- Store the resulting client ID and client secret as `GOOGLE_CLIENT_ID` and
  `GOOGLE_CLIENT_SECRET`, deploy, and connect Gmail from `/messages`.
- Run one controlled application to a personal test inbox, reply to it, and
  verify the success toast, Jobs-to-Messages transition, attachments, Gmail
  IDs, Pub/Sub ingestion, and inbound thread rendering.
- After the round trip is proven, review and send the first 10-20 real
  applications from the ranked queue.
- Define the hosted inventory refresh and country-campaign runner deployment,
  then set the first automation policy and rate limits.
- Archive or reorganize dated audits and superseded design notes after the live
  application loop is stable.
