//! Independently updated, complete annual official calendars. No task data is written here.
use std::{collections::{BTreeMap, BTreeSet, HashSet}, io::Read, time::{Duration, Instant}};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use crate::error::{AppError, AppResult};

pub const BASE: &str = "https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/";
const BODY_LIMIT: usize = 256 * 1024;
const TIMEOUT: Duration = Duration::from_secs(15);
pub const MIGRATION: &str = "
    CREATE TABLE holiday_calendar_years(year INTEGER PRIMARY KEY, package_json TEXT NOT NULL);
    CREATE TABLE holiday_calendar_metadata(id INTEGER PRIMARY KEY CHECK(id=1), state_json TEXT NOT NULL);
";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Holiday {
    pub name: String,
    pub dates: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub named_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Annual {
    pub schema_version: u32,
    pub year: i32,
    pub revision: u32,
    pub from: String,
    pub to: String,
    pub version: String,
    pub source_url: String,
    pub verified_at: String,
    pub holidays: Vec<Holiday>,
    pub makeup_workdays: Vec<(String, String)>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub years: Vec<Annual>,
    pub available_years: Vec<i32>,
    pub last_attempt_at: Option<String>,
    pub last_success_at: Option<String>,
    pub last_error: Option<String>,
    pub checking: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CdnAnnual {
    #[serde(rename = "$schema", default)]
    _schema: Option<String>,
    #[serde(rename = "$id", default)]
    _id: Option<String>,
    year: i32,
    papers: Vec<String>,
    days: Vec<CdnDay>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CdnDay {
    name: String,
    date: String,
    is_off_day: bool,
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct CalendarState {
    pub snapshot: Snapshot,
    #[serde(default)]
    source: String,
}

pub struct UpdateJob {
    snapshot: Snapshot,
    requested: Vec<i32>,
    checked_on: String,
}

pub struct Downloaded {
    years: Vec<Annual>,
}

fn invalid(message: impl Into<String>) -> AppError { AppError::Schema(message.into()) }
fn date(value: &str) -> AppResult<NaiveDate> {
    let parsed = NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| invalid("节假日日期无效"))?;
    if value != parsed.format("%Y-%m-%d").to_string() { return Err(invalid("节假日日期格式无效")); }
    Ok(parsed)
}
fn text(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= max && !value.chars().any(char::is_control)
}
fn source(value: &str) -> bool {
    reqwest::Url::parse(value).ok().is_some_and(|url| {
        url.scheme() == "https" && url.host_str().is_some_and(|host| host == "gov.cn" || host.ends_with(".gov.cn"))
            && url.username().is_empty() && url.password().is_none() && url.port().is_none()
            && url.query().is_none() && url.fragment().is_none() && url.path() != "/" && value.len() <= 2048
    })
}

impl Annual {
    pub fn parse(body: &[u8]) -> AppResult<Self> {
        if body.len() > BODY_LIMIT { return Err(invalid("节假日数据超过大小限制")); }
        let mut annual: Self = serde_json::from_slice(body)?;
        annual.validate()?;
        Ok(annual)
    }

    fn validate(&mut self) -> AppResult<()> {
        if self.schema_version != 1 || !(1900..=2200).contains(&self.year) || self.revision == 0
            || self.from != format!("{}-01-01", self.year) || self.to != format!("{}-12-31", self.year)
            || !text(&self.version, 200) || !source(&self.source_url) || self.holidays.is_empty()
            || self.holidays.len() > 366 || self.makeup_workdays.len() > 366 {
            return Err(invalid("节假日年度数据结构或全年覆盖范围无效"));
        }
        date(&self.verified_at)?;
        let mut dates = HashSet::new();
        let mut names = HashSet::new();
        for holiday in &mut self.holidays {
            if !text(&holiday.name, 80) || !names.insert(holiday.name.clone()) || holiday.dates.is_empty() || holiday.dates.len() > 366 {
                return Err(invalid("节假日名称或日期组无效"));
            }
            if let Some(named) = &holiday.named_date {
                if date(named)?.year() != self.year || !holiday.dates.contains(named) { return Err(invalid("节日命名日期不在放假范围内")); }
            }
            for day in &holiday.dates {
                if date(day)?.year() != self.year || !dates.insert(day.clone()) { return Err(invalid("节假日日期重复或跨年")); }
            }
            holiday.dates.sort();
        }
        for (day, name) in &self.makeup_workdays {
            if !text(name, 80) || date(day)?.year() != self.year || !dates.insert(day.clone()) {
                return Err(invalid("补班日期重复、冲突或跨年"));
            }
        }
        self.holidays.sort_by(|a, b| a.name.cmp(&b.name));
        self.makeup_workdays.sort();
        Ok(())
    }
}

impl Snapshot {
    pub fn workday_on(&self, day: NaiveDate) -> Option<bool> {
        let annual = self.years.iter().find(|annual| annual.year == day.year())?;
        let text = day.to_string();
        if annual.holidays.iter().any(|holiday| holiday.dates.contains(&text)) { return Some(false); }
        if annual.makeup_workdays.iter().any(|(date, _)| date == &text) { return Some(true); }
        Some(day.weekday().number_from_monday() <= 5)
    }

    pub fn covers(&self, start: NaiveDate, end: NaiveDate) -> bool {
        start <= end && (start.year()..=end.year()).all(|year| self.years.iter().any(|annual| annual.year == year))
    }

    pub fn last_date(&self) -> Option<NaiveDate> {
        self.years.iter().map(|annual| annual.year).max().and_then(|year| NaiveDate::from_ymd_opt(year, 12, 31))
    }
}

impl CdnAnnual {
    fn parse(body: &[u8], year: i32) -> AppResult<Self> {
        if body.len() > BODY_LIMIT { return Err(invalid("节假日响应超过大小限制")); }
        let data: Self = serde_json::from_slice(body)?;
        if data.year != year || !(1900..=2200).contains(&year) || data.papers.is_empty()
            || data.papers.len() > 16 || data.papers.iter().any(|paper| !source(paper))
            || data.days.is_empty() || data.days.len() > 732 {
            return Err(invalid("CDN 节假日年份、公告来源或日期列表无效"));
        }
        let mut seen = HashSet::new();
        for day in &data.days {
            // A notice for next year can also arrange the preceding December.
            let date = date(&day.date)?;
            if !text(&day.name, 80) || !(date.year() == year || (date.year() == year - 1 && date.month() == 12))
                || !seen.insert(&day.date) {
                return Err(invalid("CDN 节假日日期重复、冲突或超出公告年度范围"));
            }
        }
        if !data.days.iter().any(|day| day.is_off_day && day.date.starts_with(&format!("{year}-"))) {
            return Err(invalid("CDN 年度数据缺少本年放假安排"));
        }
        Ok(data)
    }

    fn annual(&self, adjacent: Option<&Self>, old: Option<&Annual>, checked_on: &str) -> AppResult<Annual> {
        let year = self.year;
        let prefix = format!("{year}-");
        let mut days = BTreeMap::new();
        for packet in std::iter::once(self).chain(adjacent) {
            for day in &packet.days {
                if day.date.starts_with(&prefix) { days.insert(day.date.clone(), day.clone()); }
            }
        }
        // If the next notice is temporarily absent, retain known December exceptions.
        if adjacent.is_none() {
            if let Some(old) = old {
                let december = format!("{year}-12-");
                for holiday in &old.holidays {
                    for date in &holiday.dates {
                        if date.starts_with(&december) {
                            days.entry(date.clone()).or_insert(CdnDay { name: holiday.name.clone(), date: date.clone(), is_off_day: true });
                        }
                    }
                }
                for (date, name) in &old.makeup_workdays {
                    if date.starts_with(&december) {
                        days.entry(date.clone()).or_insert(CdnDay { name: name.clone(), date: date.clone(), is_off_day: false });
                    }
                }
            }
        }
        let mut groups = BTreeMap::<String, Vec<String>>::new();
        let mut makeup_workdays = Vec::new();
        for day in days.into_values() {
            if day.is_off_day { groups.entry(day.name).or_default().push(day.date); }
            else { makeup_workdays.push((day.date, day.name)); }
        }
        let holidays = groups.into_iter().map(|(name, dates)| {
            let named_date = old.and_then(|old| old.holidays.iter().find(|holiday| holiday.name == name))
                .and_then(|holiday| holiday.named_date.clone()).filter(|date| dates.contains(date));
            Holiday { name, dates, named_date }
        }).collect();
        let mut annual = Annual {
            schema_version: 1, year, revision: old.map_or(1, |annual| annual.revision),
            from: format!("{year}-01-01"), to: format!("{year}-12-31"),
            version: format!("NateScarlet/holiday-cn {year}（jsDelivr）"),
            source_url: self.papers[0].clone(), verified_at: checked_on.into(), holidays, makeup_workdays,
        };
        annual.validate()?;
        if let Some(old) = old {
            if annual.holidays == old.holidays && annual.makeup_workdays == old.makeup_workdays && annual.source_url == old.source_url {
                return Ok(old.clone());
            }
            annual.revision = old.revision.checked_add(1).ok_or_else(|| invalid("节假日本地修订号已达上限"))?;
        }
        Ok(annual)
    }
}

fn merge(snapshot: &Snapshot, years: Vec<Annual>) -> AppResult<Snapshot> {
    let mut next = snapshot.clone();
    let mut seen = HashSet::new();
    for mut annual in years {
        annual.validate()?;
        if !seen.insert(annual.year) { return Err(invalid("年度数据包重复")); }
        if let Some(old) = next.years.iter_mut().find(|old| old.year == annual.year) {
            if annual.revision < old.revision || (annual.revision == old.revision && annual != *old) {
                return Err(invalid("拒绝节假日数据降级或同修订号内容变化"));
            }
            *old = annual;
        } else { next.years.push(annual); }
    }
    next.years.sort_by_key(|annual| annual.year);
    Ok(next)
}

fn persist_metadata(connection: &Connection, state: &CalendarState) -> AppResult<()> {
    // Annual payloads are stored only in their own table, not duplicated in metadata.
    let mut metadata = state.clone();
    metadata.snapshot.years.clear();
    metadata.snapshot.checking = false;
    connection.execute("INSERT INTO holiday_calendar_metadata(id,state_json) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json",
        [serde_json::to_string(&metadata)?])?;
    Ok(())
}

impl CalendarState {
    pub fn bundled() -> Self {
        let annual = Annual::parse(include_bytes!("../../data/holidays/2026.json")).expect("valid bundled annual calendar");
        Self { snapshot: Snapshot { years: vec![annual], ..Snapshot::default() }, source: BASE.into() }
    }

    pub fn load(connection: &Connection) -> AppResult<Self> {
        let mut state = Self::bundled();
        let metadata: Option<String> = connection.query_row("SELECT state_json FROM holiday_calendar_metadata WHERE id=1", [], |row| row.get(0)).optional()?;
        if let Some(json) = metadata {
            if let Ok(mut cached) = serde_json::from_str::<Self>(&json) {
                cached.snapshot.years = state.snapshot.years;
                cached.snapshot.checking = false;
                // Old self-hosted manifest metadata is ignored; only validated annual caches remain.
                cached.snapshot.available_years.clear();
                if cached.source != BASE {
                    cached.snapshot.last_attempt_at = None;
                    cached.snapshot.last_success_at = None;
                    cached.snapshot.last_error = None;
                }
                cached.source = BASE.into();
                state = cached;
            } else { state.snapshot.last_error = Some("本地节假日更新状态无效，已保留内置数据".into()); }
        }
        let mut statement = connection.prepare("SELECT year,package_json FROM holiday_calendar_years ORDER BY year")?;
        let rows = statement.query_map([], |row| Ok((row.get::<_, i32>(0)?, row.get::<_, String>(1)?)))?;
        for row in rows {
            let (year, json) = row?;
            match Annual::parse(json.as_bytes()).and_then(|annual| {
                if annual.year != year { return Err(invalid("本地节假日年度键不匹配")); }
                merge(&state.snapshot, vec![annual])
            }) {
                Ok(next) => state.snapshot = next,
                Err(error) => state.snapshot.last_error = Some(format!("本地节假日缓存无效，已保留其他有效数据：{error}")),
            }
        }
        state.snapshot.available_years = state.snapshot.years.iter().map(|annual| annual.year).collect();
        Ok(state)
    }

    pub fn begin(&mut self, connection: &Connection, requested: Vec<i32>, force: bool, now: DateTime<Utc>) -> AppResult<Option<UpdateJob>> {
        if requested.len() > 301 || requested.iter().any(|year| !(1900..=2200).contains(year)) { return Err(invalid("请求年份超出范围")); }
        if self.snapshot.checking { return Ok(None); }
        let recent = self.snapshot.last_attempt_at.as_deref().and_then(|value| DateTime::parse_from_rfc3339(value).ok())
            .is_some_and(|last| now.signed_duration_since(last).num_seconds() < 86400);
        if !force && recent { return Ok(None); }
        let mut targets = requested.into_iter().collect::<BTreeSet<_>>();
        targets.extend(self.snapshot.years.iter().map(|annual| annual.year));
        targets.extend([now.year(), now.year() + 1].into_iter().filter(|year| (1900..=2200).contains(year)));
        let requested = match (targets.first(), targets.last()) {
            (Some(&first), Some(&last)) => (first..=last).collect(),
            _ => Vec::new(),
        };
        let mut next = self.clone();
        next.source = BASE.into();
        next.snapshot.last_attempt_at = Some(now.to_rfc3339());
        next.snapshot.last_error = None;
        next.snapshot.checking = true;
        persist_metadata(connection, &next)?;
        *self = next;
        Ok(Some(UpdateJob { snapshot: self.snapshot.clone(), requested, checked_on: now.date_naive().to_string() }))
    }

    pub fn finish(&mut self, connection: &mut Connection, result: AppResult<Downloaded>, now: DateTime<Utc>) -> Snapshot {
        let outcome = result.and_then(|downloaded| {
            let mut next = self.clone();
            next.snapshot = merge(&self.snapshot, downloaded.years.clone())?;
            next.snapshot.available_years = next.snapshot.years.iter().map(|annual| annual.year).collect();
            next.snapshot.last_success_at = Some(now.to_rfc3339());
            next.snapshot.last_error = None;
            next.snapshot.checking = false;
            let tx = connection.transaction()?;
            for annual in downloaded.years {
                tx.execute("INSERT INTO holiday_calendar_years(year,package_json) VALUES(?1,?2) ON CONFLICT(year) DO UPDATE SET package_json=excluded.package_json",
                    params![annual.year, serde_json::to_string(&annual)?])?;
            }
            persist_metadata(&tx, &next)?;
            tx.commit()?;
            *self = next;
            Ok(())
        });
        if let Err(error) = outcome {
            self.snapshot.checking = false;
            self.snapshot.last_error = Some(error.to_string());
            let _ = persist_metadata(connection, self);
        }
        self.snapshot.clone()
    }
}

fn fetch_body(client: &reqwest::blocking::Client, url: &str, timeout: Duration) -> AppResult<Option<Vec<u8>>> {
    let response = client.get(url).timeout(timeout).send().map_err(|error| invalid(error.to_string()))?;
    if response.status() == reqwest::StatusCode::NOT_FOUND { return Ok(None); }
    let response = response.error_for_status().map_err(|error| invalid(error.to_string()))?;
    if !response.status().is_success() { return Err(invalid("节假日下载拒绝重定向")); }
    if response.content_length().is_some_and(|size| size > BODY_LIMIT as u64) { return Err(invalid("节假日响应超过大小限制")); }
    let mut body = Vec::new();
    response.take((BODY_LIMIT + 1) as u64).read_to_end(&mut body).map_err(|error| invalid(error.to_string()))?;
    if body.len() > BODY_LIMIT { return Err(invalid("节假日响应超过大小限制")); }
    Ok(Some(body))
}

impl UpdateJob {
    pub fn download(self) -> AppResult<Downloaded> {
        let client = reqwest::blocking::Client::builder().redirect(reqwest::redirect::Policy::none())
            .timeout(TIMEOUT).build().map_err(|error| invalid(error.to_string()))?;
        self.download_with(|path, remaining| fetch_body(&client, &format!("{BASE}{path}"), remaining))
    }

    pub(crate) fn download_with(self, mut fetch: impl FnMut(&str, Duration) -> AppResult<Option<Vec<u8>>>) -> AppResult<Downloaded> {
        let started = Instant::now();
        let mut packets = BTreeMap::new();
        let mut requested = self.requested.iter().copied().collect::<BTreeSet<_>>();
        if let Some(&last) = requested.last() { if last < 2200 { requested.insert(last + 1); } }
        for year in requested {
            let remaining = TIMEOUT.checked_sub(started.elapsed()).filter(|left| !left.is_zero()).ok_or_else(|| invalid("节假日更新超时"))?;
            let body = fetch(&format!("{year}.json"), remaining)?;
            if started.elapsed() > TIMEOUT { return Err(invalid("节假日更新超时")); }
            if let Some(body) = body { packets.insert(year, CdnAnnual::parse(&body, year)?); }
        }
        let mut years = Vec::new();
        for year in self.requested {
            let old = self.snapshot.years.iter().find(|annual| annual.year == year);
            let adjacent = packets.get(&(year + 1));
            if let Some(packet) = packets.get(&year) {
                years.push(packet.annual(adjacent, old, &self.checked_on)?);
            } else if let (Some(old), Some(adjacent)) = (old, adjacent) {
                // A missing own-year file cannot suppress explicit updates to a covered December.
                let mut days = old.holidays.iter().flat_map(|holiday| holiday.dates.iter().map(|date| CdnDay {
                    name: holiday.name.clone(), date: date.clone(), is_off_day: true,
                })).collect::<Vec<_>>();
                days.extend(old.makeup_workdays.iter().map(|(date, name)| CdnDay { name: name.clone(), date: date.clone(), is_off_day: false }));
                let cached = CdnAnnual { _schema: None, _id: None, year, papers: vec![old.source_url.clone()], days };
                years.push(cached.annual(Some(adjacent), Some(old), &self.checked_on)?);
            }
        }
        merge(&self.snapshot, years.clone())?;
        Ok(Downloaded { years })
    }
}

#[cfg(test)]
#[path = "holiday_calendar_tests.rs"]
mod tests;
