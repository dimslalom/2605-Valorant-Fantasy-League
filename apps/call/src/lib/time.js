// Dates are grouped in the viewer's own timezone, like the official schedule.
const dayFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' });
const longFmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

export const dayKey = unix => dayFmt.format(new Date(unix * 1000));
export const todayKey = () => dayFmt.format(new Date());
export const timeOf = unix => timeFmt.format(new Date(unix * 1000));
export const longDay = key => longFmt.format(new Date(`${key}T12:00:00`));
