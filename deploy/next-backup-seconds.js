// Seconds until the next 02:30 Europe/London (plain Node, no build step). Used by backup-loop.sh.
const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const now = Date.now();
let t = Math.ceil(now / 60000) * 60000;
while (fmt.format(t) !== "02:30") t += 60000;
console.log(Math.ceil((t - now) / 1000));
