// Local, rule-based categorization. Rules are plain lowercase substrings; no regex from users.

export const CATEGORIES = [
  // kind: 'spend' counts as spending; 'income' as income; 'neutral' excluded from both.
  // bucket: 50/30/20 grouping used by the budget suggestion.
  { name: 'Housing', kind: 'spend', bucket: 'needs' },
  { name: 'Utilities', kind: 'spend', bucket: 'needs' },
  { name: 'Groceries', kind: 'spend', bucket: 'needs' },
  { name: 'Transport', kind: 'spend', bucket: 'needs' },
  { name: 'Health', kind: 'spend', bucket: 'needs' },
  { name: 'Insurance', kind: 'spend', bucket: 'needs' },
  { name: 'Childcare & education', kind: 'spend', bucket: 'needs' },
  { name: 'Debt payments', kind: 'spend', bucket: 'needs' },
  { name: 'Dining', kind: 'spend', bucket: 'wants' },
  { name: 'Subscriptions', kind: 'spend', bucket: 'wants' },
  { name: 'Shopping', kind: 'spend', bucket: 'wants' },
  { name: 'Entertainment', kind: 'spend', bucket: 'wants' },
  { name: 'Travel', kind: 'spend', bucket: 'wants' },
  { name: 'Personal care', kind: 'spend', bucket: 'wants' },
  { name: 'Gifts & donations', kind: 'spend', bucket: 'wants' },
  { name: 'Fees & interest', kind: 'spend', bucket: 'wants' },
  { name: 'Cash & ATM', kind: 'spend', bucket: 'wants' },
  { name: 'Other', kind: 'spend', bucket: 'wants' },
  { name: 'Paycheck', kind: 'income', bucket: null },
  { name: 'Other income', kind: 'income', bucket: null },
  { name: 'Transfer', kind: 'neutral', bucket: null },
  { name: 'Credit card payment', kind: 'neutral', bucket: null },
];

export const NEUTRAL = new Set(['Transfer', 'Credit card payment']);

// Order matters only for equal-length matches; longest matching keyword wins.
export const DEFAULT_RULES = {
  'Credit card payment': ['payment thank you', 'payment - thank you', 'autopay payment', 'credit card payment', 'card payment', 'cardmember serv', 'crd pmt', 'epayment', 'online payment thank', 'mobile payment thank', 'automatic payment', 'payment received', 'applecard gsbank', 'capital one mobile pmt', 'chase credit crd', 'citi card online', 'amex epayment', 'discover e-payment'],
  Transfer: ['transfer to', 'transfer from', 'online transfer', 'internal transfer', 'xfer', 'trnsfr', 'to savings', 'from savings', 'to checking', 'from checking', 'acct to acct', 'funds transfer', 'brokerage transfer'],
  Paycheck: ['payroll', 'direct dep', 'dir dep', 'salary', 'paycheck', 'adp ', 'gusto', 'paychex', 'net pay'],
  'Other income': ['interest paid', 'interest earned', 'dividend', 'tax refund', 'irs treas', 'cashback', 'cash back reward', 'venmo cashout'],
  Housing: ['rent', 'mortgage', 'hoa ', 'property mgmt', 'apartments', 'property management', 'landlord'],
  Utilities: ['electric', 'energy', 'water', 'sewer', 'gas co', 'natural gas', 'comcast', 'xfinity', 'verizon', 'at&t', 'att*', 't-mobile', 'tmobile', 'spectrum', 'internet', 'utility', 'pg&e', 'con ed', 'duke energy', 'waste mgmt', 'cox comm'],
  Groceries: ['grocery', 'groceries', 'supermarket', 'whole foods', 'trader joe', 'safeway', 'kroger', 'aldi', 'publix', 'wegmans', 'heb ', 'h-e-b', 'food lion', 'giant eagle', 'stop & shop', 'sprouts', 'costco', 'sams club', 'market basket', 'albertsons', 'vons', 'meijer', 'winco', 'lidl', 'instacart'],
  Dining: ['restaurant', 'cafe', 'coffee', 'starbucks', 'dunkin', 'mcdonald', 'burger', 'pizza', 'taco', 'chipotle', 'subway', 'doordash', 'uber eats', 'ubereats', 'grubhub', 'postmates', 'diner', 'bistro', 'grill', 'kitchen', 'bar & ', 'pub ', 'sushi', 'bakery', 'panera', 'wendy', 'chick-fil', 'kfc', 'domino', 'sweetgreen', 'tst*', 'sq *'],
  Transport: ['uber', 'lyft', 'shell', 'chevron', 'exxon', 'mobil', 'bp ', 'arco', 'sunoco', 'valero', 'texaco', 'citgo', 'fuel', 'gas station', 'parking', 'toll', 'transit', 'metro', 'mta ', 'bart', 'amtrak', 'dmv', 'auto repair', 'jiffy lube', 'car wash', 'ez pass', 'e-zpass', 'fastrak'],
  Health: ['pharmacy', 'cvs', 'walgreens', 'rite aid', 'medical', 'clinic', 'hospital', 'dental', 'dentist', 'doctor', 'optometr', 'vision', 'labcorp', 'quest diag', 'therapy', 'urgent care'],
  Insurance: ['insurance', 'geico', 'state farm', 'allstate', 'progressive', 'lemonade', 'usaa ins', 'liberty mutual', 'farmers ins', 'nationwide'],
  'Childcare & education': ['daycare', 'childcare', 'tuition', 'school', 'university', 'college', 'coursera', 'udemy', 'textbook'],
  'Debt payments': ['loan payment', 'loan pmt', 'student loan', 'navient', 'nelnet', 'great lakes', 'mohela', 'sallie mae', 'auto loan', 'car loan', 'sofi loan', 'lending club', 'upstart', 'affirm', 'klarna', 'afterpay'],
  Subscriptions: ['netflix', 'spotify', 'hulu', 'disney+', 'disney plus', 'hbo', 'max.com', 'paramount+', 'peacock', 'apple.com/bill', 'itunes', 'google *', 'youtube premium', 'amazon prime', 'prime video', 'audible', 'patreon', 'dropbox', 'icloud', 'microsoft 365', 'adobe', 'nytimes', 'subscription', 'membership', 'gym', 'planet fitness', 'peloton', 'chatgpt', 'openai', 'duolingo'],
  Shopping: ['amazon', 'amzn', 'target', 'walmart', 'best buy', 'ebay', 'etsy', 'home depot', 'lowe', 'ikea', 'macy', 'nordstrom', 'old navy', 'gap ', 'h&m', 'zara', 'tj maxx', 'marshalls', 'kohl', 'wayfair', 'shein', 'temu', 'apple store'],
  Entertainment: ['cinema', 'theater', 'theatre', 'amc ', 'regal', 'steam', 'playstation', 'xbox', 'nintendo', 'ticketmaster', 'stubhub', 'concert', 'bowling', 'museum'],
  Travel: ['airline', 'airlines', 'delta air', 'united air', 'american air', 'southwest', 'jetblue', 'alaska air', 'hotel', 'marriott', 'hilton', 'hyatt', 'airbnb', 'vrbo', 'expedia', 'booking.com', 'hertz', 'avis', 'enterprise rent'],
  'Personal care': ['salon', 'barber', 'spa ', 'nail', 'sephora', 'ulta', 'cosmetic'],
  'Gifts & donations': ['donation', 'charity', 'church', 'gofundme', 'red cross', 'unicef', 'gift'],
  'Fees & interest': ['fee', 'interest charge', 'finance charge', 'overdraft', 'late charge', 'service charge', 'annual membership fee'],
  'Cash & ATM': ['atm', 'cash withdrawal', 'withdrawal at'],
};

export function categoryNames() { return CATEGORIES.map((c) => c.name); }

export function categoryKind(name, custom = []) {
  const c = CATEGORIES.find((x) => x.name === name);
  if (c) return c.kind;
  return custom.includes(name) ? 'spend' : 'spend';
}

export function categoryBucket(name) {
  const c = CATEGORIES.find((x) => x.name === name);
  return c ? c.bucket : 'wants';
}

/** Flatten the default rules into [{ pattern, category, source }]. */
export function defaultRuleList() {
  const list = [];
  for (const [category, patterns] of Object.entries(DEFAULT_RULES)) {
    for (const pattern of patterns) list.push({ pattern, category, source: 'default' });
  }
  return list;
}

/**
 * Choose a category for a transaction.
 * User rules always beat default rules; within a group the longest match wins.
 * Falls back by sign: inflows -> 'Other income', outflows -> 'Other'.
 */
export function categorize(description, amount, userRules, defaultRules) {
  const text = ' ' + String(description).toLowerCase() + ' ';
  const pick = (rules) => {
    let best = null;
    for (const r of rules) {
      if (r.pattern && matchesAtWordStart(text, r.pattern) && (!best || r.pattern.length > best.pattern.length)) best = r;
    }
    return best;
  };
  const user = pick(userRules);
  if (user) return { category: user.category, rule: user };
  const def = pick(defaultRules);
  if (def) {
    const kind = categoryKind(def.category);
    // An income keyword on an outflow (or a spend keyword on a "Paycheck"-like inflow) is suspicious;
    // fall back to sign-based defaults in that case.
    if (kind === 'income' && amount < 0) return { category: 'Other', rule: null };
    if (kind === 'spend' && amount > 0 && def.category !== 'Debt payments') {
      // positive amount at a store = refund; keep the store's category so it nets out.
      return { category: def.category, rule: def, refund: true };
    }
    return { category: def.category, rule: def };
  }
  if (amount > 0) {
    if (/\b(refund|return|reversal|credit adj)/i.test(description)) return { category: 'Other', rule: null, refund: true };
    return { category: 'Other income', rule: null };
  }
  return { category: 'Other', rule: null };
}

/** Substring match that must start at a word boundary ("rent" matches "RENT PMT", not "CURRENT"). */
export function matchesAtWordStart(text, pattern) {
  let i = text.indexOf(pattern);
  while (i !== -1) {
    const before = i === 0 ? ' ' : text[i - 1];
    if (!/[a-z0-9]/.test(before) || !/[a-z0-9]/.test(pattern[0])) return true;
    i = text.indexOf(pattern, i + 1);
  }
  return false;
}

/** Turn a description into a safe, short rule pattern suggestion. */
export function suggestPattern(merchantKeyText) {
  return String(merchantKeyText).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 40);
}
