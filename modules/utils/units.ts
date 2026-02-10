export function format_date(date: Date){
    return Intl.DateTimeFormat("en-US", {dateStyle: "long", timeStyle: "short"}).format(date);
}