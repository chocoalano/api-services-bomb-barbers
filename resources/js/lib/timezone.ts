export const APP_TIMEZONE = 'Asia/Jakarta';

const jakartaDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

export const jakartaDateStamp = (date = new Date()) => jakartaDateFormatter.format(date);
