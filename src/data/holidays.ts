/**
 * Exchange holiday calendars, as exchange-local dates (YYYY-MM-DD).
 *
 * Update every year when the exchanges publish their circulars:
 *   NSE/BSE: https://www.nseindia.com/resources/exchange-communication-holidays
 *   NYSE/NASDAQ: https://www.nyse.com/markets/hours-calendars
 *
 * 2027 India dates are PROVISIONAL (compiled from broker calendars in Nov 2026, before NSE's
 * official 2027 circular). Lunar festivals (Holi, Id, Diwali) are the most likely to move.
 * NSE's Diwali Muhurat session is not modelled.
 */

export interface Holiday {
  date: string;
  name: string;
  /** Exchange-local close time ("HH:MM") for half days; absent for full closures. */
  earlyClose?: string;
  provisional?: boolean;
}

export const INDIA_HOLIDAYS: Holiday[] = [
  { date: '2026-01-15', name: 'Municipal Corporation Election (Maharashtra)' },
  { date: '2026-01-26', name: 'Republic Day' },
  { date: '2026-03-03', name: 'Holi' },
  { date: '2026-03-26', name: 'Shri Ram Navami' },
  { date: '2026-03-31', name: 'Shri Mahavir Jayanti' },
  { date: '2026-04-03', name: 'Good Friday' },
  { date: '2026-04-14', name: 'Dr. Baba Saheb Ambedkar Jayanti' },
  { date: '2026-05-01', name: 'Maharashtra Day' },
  { date: '2026-05-28', name: 'Bakri Id' },
  { date: '2026-06-26', name: 'Muharram' },
  { date: '2026-09-14', name: 'Ganesh Chaturthi' },
  { date: '2026-10-02', name: 'Mahatma Gandhi Jayanti' },
  { date: '2026-10-20', name: 'Dussehra' },
  { date: '2026-11-10', name: 'Diwali Balipratipada' },
  { date: '2026-11-24', name: 'Guru Nanak Jayanti' },
  { date: '2026-12-25', name: 'Christmas' },

  { date: '2027-01-26', name: 'Republic Day', provisional: true },
  { date: '2027-03-10', name: 'Id-Ul-Fitr', provisional: true },
  { date: '2027-03-22', name: 'Holi', provisional: true },
  { date: '2027-03-26', name: 'Good Friday', provisional: true },
  { date: '2027-04-14', name: 'Dr. Baba Saheb Ambedkar Jayanti', provisional: true },
  { date: '2027-04-15', name: 'Shri Ram Navami', provisional: true },
  { date: '2027-05-17', name: 'Bakri Id', provisional: true },
  { date: '2027-06-16', name: 'Muharram', provisional: true },
  { date: '2027-10-29', name: 'Diwali Laxmi Pujan', provisional: true },
];

export const US_HOLIDAYS: Holiday[] = [
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-01-19', name: 'Martin Luther King Jr. Day' },
  { date: '2026-02-16', name: "Washington's Birthday" },
  { date: '2026-04-03', name: 'Good Friday' },
  { date: '2026-05-25', name: 'Memorial Day' },
  { date: '2026-06-19', name: 'Juneteenth' },
  { date: '2026-07-03', name: 'Independence Day (observed)' },
  { date: '2026-09-07', name: 'Labor Day' },
  { date: '2026-11-26', name: 'Thanksgiving Day' },
  { date: '2026-11-27', name: 'Day after Thanksgiving', earlyClose: '13:00' },
  { date: '2026-12-24', name: 'Christmas Eve', earlyClose: '13:00' },
  { date: '2026-12-25', name: 'Christmas Day' },

  { date: '2027-01-01', name: "New Year's Day" },
  { date: '2027-01-18', name: 'Martin Luther King Jr. Day' },
  { date: '2027-02-15', name: "Washington's Birthday" },
  { date: '2027-03-26', name: 'Good Friday' },
  { date: '2027-05-31', name: 'Memorial Day' },
  { date: '2027-06-18', name: 'Juneteenth (observed)' },
  { date: '2027-07-05', name: 'Independence Day (observed)' },
  { date: '2027-09-06', name: 'Labor Day' },
  { date: '2027-11-25', name: 'Thanksgiving Day' },
  { date: '2027-11-26', name: 'Day after Thanksgiving', earlyClose: '13:00' },
  { date: '2027-12-24', name: 'Christmas Day (observed)' },
];
