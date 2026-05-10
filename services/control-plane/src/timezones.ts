// Iter 60 — lightweight phone → timezone inference.
//
// Not a full carrier-grade lookup: enough to bucket a lead list into
// "what time is it for these people right now?" answers for the UI.
//
// NANP (country code 1): 3-digit NPA → IANA timezone via a curated
// table covering the ~80 NPAs with the highest population in the US
// + most of Canada. Unmatched NPAs fall through to "America/New_York"
// (Eastern) since that's the most common bucket. Non-NANP numbers
// route through a country-code → primary TZ table.

// NPA → IANA TZ. Curated; not exhaustive. Add to it as needed.
const NPA_TO_TZ: Record<string, string> = {
  // Eastern — US
  '201': 'America/New_York',
  '202': 'America/New_York',
  '203': 'America/New_York',
  '212': 'America/New_York',
  '215': 'America/New_York',
  '216': 'America/New_York',
  '267': 'America/New_York',
  '301': 'America/New_York',
  '302': 'America/New_York',
  '305': 'America/New_York',
  '321': 'America/New_York',
  '347': 'America/New_York',
  '386': 'America/New_York',
  '407': 'America/New_York',
  '410': 'America/New_York',
  '412': 'America/New_York',
  '443': 'America/New_York',
  '484': 'America/New_York',
  '516': 'America/New_York',
  '561': 'America/New_York',
  '570': 'America/New_York',
  '585': 'America/New_York',
  '610': 'America/New_York',
  '617': 'America/New_York',
  '631': 'America/New_York',
  '646': 'America/New_York',
  '703': 'America/New_York',
  '704': 'America/New_York',
  '716': 'America/New_York',
  '718': 'America/New_York',
  '724': 'America/New_York',
  '732': 'America/New_York',
  '754': 'America/New_York',
  '757': 'America/New_York',
  '786': 'America/New_York',
  '813': 'America/New_York',
  '814': 'America/New_York',
  '845': 'America/New_York',
  '850': 'America/New_York',
  '856': 'America/New_York',
  '857': 'America/New_York',
  '860': 'America/New_York',
  '904': 'America/New_York',
  '914': 'America/New_York',
  '917': 'America/New_York',
  '929': 'America/New_York',
  '954': 'America/New_York',
  '973': 'America/New_York',
  // Central — US
  '210': 'America/Chicago',
  '214': 'America/Chicago',
  '224': 'America/Chicago',
  '281': 'America/Chicago',
  '309': 'America/Chicago',
  '312': 'America/Chicago',
  '314': 'America/Chicago',
  '316': 'America/Chicago',
  '331': 'America/Chicago',
  '361': 'America/Chicago',
  '405': 'America/Chicago',
  '414': 'America/Chicago',
  '469': 'America/Chicago',
  '501': 'America/Chicago',
  '512': 'America/Chicago',
  '515': 'America/Chicago',
  '563': 'America/Chicago',
  '618': 'America/Chicago',
  '630': 'America/Chicago',
  '636': 'America/Chicago',
  '651': 'America/Chicago',
  '662': 'America/Chicago',
  '682': 'America/Chicago',
  '708': 'America/Chicago',
  '713': 'America/Chicago',
  '763': 'America/Chicago',
  '773': 'America/Chicago',
  '779': 'America/Chicago',
  '785': 'America/Chicago',
  '816': 'America/Chicago',
  '832': 'America/Chicago',
  '847': 'America/Chicago',
  '870': 'America/Chicago',
  '901': 'America/Chicago',
  '903': 'America/Chicago',
  '913': 'America/Chicago',
  '915': 'America/Chicago',
  '936': 'America/Chicago',
  '940': 'America/Chicago',
  '952': 'America/Chicago',
  '956': 'America/Chicago',
  '972': 'America/Chicago',
  // Mountain — US
  '303': 'America/Denver',
  '307': 'America/Denver',
  '385': 'America/Denver',
  '435': 'America/Denver',
  '505': 'America/Denver',
  '575': 'America/Denver',
  '719': 'America/Denver',
  '720': 'America/Denver',
  '801': 'America/Denver',
  '970': 'America/Denver',
  // Mountain (no DST) — Arizona
  '480': 'America/Phoenix',
  '520': 'America/Phoenix',
  '602': 'America/Phoenix',
  '623': 'America/Phoenix',
  '928': 'America/Phoenix',
  // Pacific — US
  '206': 'America/Los_Angeles',
  '209': 'America/Los_Angeles',
  '213': 'America/Los_Angeles',
  '253': 'America/Los_Angeles',
  '310': 'America/Los_Angeles',
  '323': 'America/Los_Angeles',
  '360': 'America/Los_Angeles',
  '408': 'America/Los_Angeles',
  '415': 'America/Los_Angeles',
  '425': 'America/Los_Angeles',
  '503': 'America/Los_Angeles',
  '510': 'America/Los_Angeles',
  '530': 'America/Los_Angeles',
  '541': 'America/Los_Angeles',
  '559': 'America/Los_Angeles',
  '619': 'America/Los_Angeles',
  '626': 'America/Los_Angeles',
  '650': 'America/Los_Angeles',
  '661': 'America/Los_Angeles',
  '702': 'America/Los_Angeles',
  '714': 'America/Los_Angeles',
  '747': 'America/Los_Angeles',
  '760': 'America/Los_Angeles',
  '775': 'America/Los_Angeles',
  '805': 'America/Los_Angeles',
  '818': 'America/Los_Angeles',
  '858': 'America/Los_Angeles',
  '909': 'America/Los_Angeles',
  '916': 'America/Los_Angeles',
  '925': 'America/Los_Angeles',
  '949': 'America/Los_Angeles',
  '951': 'America/Los_Angeles',
  // Alaska / Hawaii
  '907': 'America/Anchorage',
  '808': 'Pacific/Honolulu',
  // Canada — main
  '236': 'America/Vancouver',
  '250': 'America/Vancouver',
  '604': 'America/Vancouver',
  '778': 'America/Vancouver',
  '403': 'America/Edmonton',
  '587': 'America/Edmonton',
  '780': 'America/Edmonton',
  '825': 'America/Edmonton',
  '306': 'America/Regina',
  '639': 'America/Regina',
  '204': 'America/Winnipeg',
  '431': 'America/Winnipeg',
  '226': 'America/Toronto',
  '249': 'America/Toronto',
  '289': 'America/Toronto',
  '343': 'America/Toronto',
  '416': 'America/Toronto',
  '437': 'America/Toronto',
  '519': 'America/Toronto',
  '548': 'America/Toronto',
  '613': 'America/Toronto',
  '647': 'America/Toronto',
  '705': 'America/Toronto',
  '807': 'America/Toronto',
  '905': 'America/Toronto',
  '418': 'America/Montreal',
  '438': 'America/Montreal',
  '450': 'America/Montreal',
  '514': 'America/Montreal',
  '579': 'America/Montreal',
  '581': 'America/Montreal',
  '506': 'America/Halifax',
  '709': 'America/St_Johns',
  '867': 'America/Whitehorse',
};

// Country code → primary IANA TZ. First-cut bucketing for international
// lists — replace with a richer lookup later when reports need it.
const COUNTRY_CODE_TZ: Array<{ prefix: string; tz: string }> = [
  // Longest first so 1XX matches before 1 (NANP handled separately)
  { prefix: '880', tz: 'Asia/Dhaka' },
  { prefix: '852', tz: 'Asia/Hong_Kong' },
  { prefix: '254', tz: 'Africa/Nairobi' },
  { prefix: '234', tz: 'Africa/Lagos' },
  { prefix: '233', tz: 'Africa/Accra' },
  { prefix: '212', tz: 'Africa/Casablanca' },
  { prefix: '971', tz: 'Asia/Dubai' },
  { prefix: '966', tz: 'Asia/Riyadh' },
  { prefix: '358', tz: 'Europe/Helsinki' },
  { prefix: '353', tz: 'Europe/Dublin' },
  { prefix: '351', tz: 'Europe/Lisbon' },
  { prefix: '420', tz: 'Europe/Prague' },
  { prefix: '423', tz: 'Europe/Vaduz' },
  { prefix: '32', tz: 'Europe/Brussels' },
  { prefix: '33', tz: 'Europe/Paris' },
  { prefix: '34', tz: 'Europe/Madrid' },
  { prefix: '36', tz: 'Europe/Budapest' },
  { prefix: '39', tz: 'Europe/Rome' },
  { prefix: '40', tz: 'Europe/Bucharest' },
  { prefix: '41', tz: 'Europe/Zurich' },
  { prefix: '43', tz: 'Europe/Vienna' },
  { prefix: '44', tz: 'Europe/London' },
  { prefix: '45', tz: 'Europe/Copenhagen' },
  { prefix: '46', tz: 'Europe/Stockholm' },
  { prefix: '47', tz: 'Europe/Oslo' },
  { prefix: '48', tz: 'Europe/Warsaw' },
  { prefix: '49', tz: 'Europe/Berlin' },
  { prefix: '52', tz: 'America/Mexico_City' },
  { prefix: '54', tz: 'America/Argentina/Buenos_Aires' },
  { prefix: '55', tz: 'America/Sao_Paulo' },
  { prefix: '56', tz: 'America/Santiago' },
  { prefix: '57', tz: 'America/Bogota' },
  { prefix: '58', tz: 'America/Caracas' },
  { prefix: '60', tz: 'Asia/Kuala_Lumpur' },
  { prefix: '61', tz: 'Australia/Sydney' },
  { prefix: '62', tz: 'Asia/Jakarta' },
  { prefix: '63', tz: 'Asia/Manila' },
  { prefix: '64', tz: 'Pacific/Auckland' },
  { prefix: '65', tz: 'Asia/Singapore' },
  { prefix: '66', tz: 'Asia/Bangkok' },
  { prefix: '81', tz: 'Asia/Tokyo' },
  { prefix: '82', tz: 'Asia/Seoul' },
  { prefix: '84', tz: 'Asia/Ho_Chi_Minh' },
  { prefix: '86', tz: 'Asia/Shanghai' },
  { prefix: '90', tz: 'Europe/Istanbul' },
  { prefix: '91', tz: 'Asia/Kolkata' },
  { prefix: '92', tz: 'Asia/Karachi' },
  { prefix: '94', tz: 'Asia/Colombo' },
  { prefix: '95', tz: 'Asia/Yangon' },
  { prefix: '98', tz: 'Asia/Tehran' },
  { prefix: '20', tz: 'Africa/Cairo' },
  { prefix: '27', tz: 'Africa/Johannesburg' },
  { prefix: '30', tz: 'Europe/Athens' },
  { prefix: '31', tz: 'Europe/Amsterdam' },
  { prefix: '7', tz: 'Europe/Moscow' },
];

/**
 * Iter 60 — best-effort IANA TZ for a phone number.
 * NANP: country code 1 + NPA → curated NPA → TZ map.
 * International: country-code prefix match → COUNTRY_CODE_TZ.
 * Unknown → null.
 */
export function inferLeadTimezone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  // Strip everything except digits.
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 0) return null;

  // NANP: leading 1 followed by 10 digits, OR just 10 digits.
  if (
    (digits.length === 11 && digits.startsWith('1')) ||
    digits.length === 10
  ) {
    const npa = digits.length === 11 ? digits.slice(1, 4) : digits.slice(0, 3);
    return NPA_TO_TZ[npa] ?? 'America/New_York'; // fallback to Eastern
  }

  // International — longest country-code prefix wins.
  for (const { prefix, tz } of COUNTRY_CODE_TZ) {
    if (digits.startsWith(prefix)) return tz;
  }
  return null;
}

/**
 * Hours of the day right now (0-23) in the given IANA TZ. Uses
 * Intl.DateTimeFormat so DST is handled by the host's tz database
 * — no manual offset math.
 */
export function hourInTimezone(tz: string, when = new Date()): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      hour12: false,
      timeZone: tz,
    });
    return parseInt(fmt.format(when), 10);
  } catch {
    return when.getHours();
  }
}

export function localTimeInTimezone(tz: string, when = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: tz,
    }).format(when);
  } catch {
    return `${String(when.getHours()).padStart(2, '0')}:${String(
      when.getMinutes(),
    ).padStart(2, '0')}`;
  }
}
