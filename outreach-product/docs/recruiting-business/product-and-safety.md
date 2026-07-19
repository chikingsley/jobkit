# Product layers, brand, and confidential relocation

Status: Product design brief

Last updated: 2026-07-17

## One operating system

JobKit should run one workflow across every offer:

1. capture passport, qualifications, money, constraints, and departure window;
1. resolve destination eligibility;
1. find named current routes with fresh vacancies and verified contact paths;
1. prepare the profile, documents, message, and teaching evidence;
1. obtain candidate approval for each external message, document, and submission;
1. execute applications and outreach through each employer's authoritative channel;
1. track replies, interviews, offers, deadlines, follow-ups, and verified submission state;
1. compare compensation, housing, schedule, contract, school history, and arrival support;
1. build the visa, travel, housing, and arrival plan; and
1. support the candidate through the first retention checkpoint.

Automation handles inventory, evidence, qualification, drafts, state, reminders, and audit history. Human operators handle momentum, judgment, training, interviews, school relationships, safety, and travel execution.

## Product ladder

### Open-source ESL JobKit

The candidate deploys the app into their own Cloudflare account and supplies their own service credentials. The software stays free. Cloudflare, email, and model usage flow directly to the account owner.

The current application already uses:

- Cloudflare Worker for the application and API;
- D1 for jobs, profiles, qualifications, applications, events, and message state;
- R2 for candidate documents and immutable application snapshots;
- Gmail OAuth and Pub/Sub for sending and replies;
- board-specific executors; and
- scheduled mailbox maintenance.

Turnkey self-hosting needs a bootstrap command that:

1. creates candidate-owned D1 and R2 resources;
1. writes the Cloudflare deployment bindings and resource identifiers;
1. applies every database migration in release order;
1. creates the authentication secret;
1. configures optional Gmail and board credentials; and
1. deploys the Worker and web application.

A signed normalized inventory feed should supply public jobs to every deployment. Candidate profiles, documents, applications, communications, and decisions stay in that candidate's Cloudflare account. Private board credentials remain optional extensions.

### Hosted ESL JobKit

JobKit runs the same software for candidates who want an account and immediate access. The $39 monthly plan covers managed hosting, inventory updates, profile and document state, application packets, outreach, and tracking.

### JobKit Readiness

The candidate receives a human-led route through the training:

- 120 instructional hours;
- live sessions with a teacher;
- observed teaching practice;
- scored teaching demonstration;
- application-packet review;
- destination-specific document review;
- interview preparation; and
- a readiness record that schools can inspect.

The record should state the issuer, course hours, live hours, observation, assessment, trainer, completion date, and authentication path. A recognized partner issues the credential where immigration authorities require an established document trail.

Candidates can buy individual sessions at any time. The recommended sequence remains available for people who want structure and accountability.

### Managed Placement

A human operator runs the application system with the candidate. The $2,000 fixed service includes five named routes, packets, approved submissions, follow-up, interview sessions, offer comparison, and a departure checklist.

The candidate retains approval over employers, messages, documents, and offers. The activity log shows every external action and its verified result.

### Night Mover: 90 Days

Night Mover carries the emotional core of the managed service:

> You need to get the fuck out. Give us 90 days.

The service turns a destination into a completed relocation plan. Weekly work covers candidate readiness, applications, interviews, documents, travel, temporary housing, communications, arrival, and the next income step.

The candidate brings a 90-day living runway plus an emergency return reserve. JobKit calculates the runway by destination and shows the cash requirement before the candidate commits.

### Night Mover: Seven Days

The seven-day service is a lawful departure sprint:

- safety and destination intake on day one;
- passport, entry route, money, communications, and restrictions reviewed immediately;
- flight and temporary-housing options within 24 hours;
- confidential communications and neutral notifications;
- document and device plan;
- destination contact and arrival instructions;
- 90-day budget and employment plan; and
- daily human execution through departure.

Seven days buys departure execution. Employment follows employer and immigration calendars. The service starts when the candidate has a current passport, lawful entry route, 90-day runway, and emergency reserve.

### JobKit for Schools

Schools see a separate product:

> Send the role, salary, visa constraints, and start date. Receive three screened candidates in ten business days. Pay when your selected teacher starts.

The school portal contains vacancy intake, candidate scorecards, interview scheduling, document readiness, offer state, arrival state, invoices, and replacement coverage.

## Brand structure

Use one trusted parent and two public faces:

- **ESL JobKit:** software, inventory, applications, and straightforward managed placement.
- **Night Mover by JobKit:** urgent, discreet, human relocation.
- **JobKit for Schools:** employer recruiting and teacher supply.

The brand can support four campaign voices under the same operating promise.

### Adventure

> Pick a country. We will build the route.

Visual world: airports, neighborhoods, classrooms, first apartments, pay packets, and candidate diaries. The proof is a named destination with costs, eligibility, employer, timeline, and current status.

### Stuck

> You need to get the fuck out. Give us 90 days.

Visual world: one room, one repetitive week, then a dated route card and departure board. The message speaks to paralysis and supplies one next action.

### Urgent

> Leave safely this week. Land with 90 days of runway.

Visual world: calm logistics, a packed bag, confirmed housing, Signal check-in, airport pickup, and a cash runway. The promise centers on lawful departure and landing.

### Confidential

> Move with a small circle. Control every contact. Delete the case when the work is done.

Visual world: neutral interface, code name, timed deletion, limited staff access, and plain notifications. The promise centers on privacy and controlled communication.

## Confidential workflow

Privacy should begin at the standard tier. The confidential tier adds operator time and communication controls.

### Baseline controls

- collect the minimum facts required for the chosen route;
- explain the purpose and retention period for each document;
- encrypt transport and storage;
- separate staff roles and access;
- record staff access to a case;
- use neutral email and notification text;
- let the candidate export and delete their case;
- delete documents on a published schedule; and
- keep immutable evidence of candidate-approved external actions.

### Confidential-tier controls

- Signal intake and check-ins;
- candidate-selected code name;
- neutral calendar, billing, and notification descriptions;
- dedicated operator;
- candidate-owned self-hosted deployment when useful;
- case-specific retention deadline;
- quick-exit interface;
- device and account safety checklist;
- approved destination contacts; and
- deletion confirmation at closure.

The [National Network to End Domestic Violence](https://www.techsafety.org/confidentiality) recommends data minimization and clear confidentiality practice. Its [retention guidance](https://www.techsafety.org/retention) supports explicit deletion schedules. The [National Domestic Violence Hotline safety-plan tool](https://safety-plan.thehotline.org/) demonstrates device-local safety planning and a quick exit.

Employers, recruiters, airlines, banks, accommodation providers, immigration authorities, and governments keep their own records under their rules. The case plan should show every external recipient before data leaves JobKit.

Safety-critical situations receive a warm connection to specialist domestic-violence, stalking, trafficking, legal, medical, or emergency support while JobKit handles travel and employment logistics.

## Legal scope

Night Mover handles lawful travel, relocation, employment preparation, communications, and privacy. Licensed counsel owns criminal, civil, custody, immigration, extradition, and court-order questions. A legal restriction can change the available route, destination, or departure date.

The intake should screen for:

- active court orders and travel restrictions;
- child-custody and dependent travel issues;
- immigration status and visa history;
- criminal proceedings or warrants;
- debt or contract issues affecting travel;
- immediate physical danger;
- coercion, stalking, trafficking, or monitored devices; and
- urgent medical or mental-health needs.

The result routes the candidate to the right professional while the operator continues every safe, authorized logistics task.

## Product truth

Every campaign should show concrete proof:

- candidate eligibility;
- named school, recruiter, or program;
- current vacancy or confirmed contact;
- exact costs and cash runway;
- salary and benefits;
- visa and document path;
- application state;
- interview and offer dates;
- housing and arrival plan; and
- verified outcome.

The advertisement can be dramatic because the underlying route card is specific.
