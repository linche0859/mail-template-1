const path = require("path");
const gulp = require("gulp");
const mjml = require("gulp-mjml");
const mjmlEngine = require("mjml");
const browserSync = require("browser-sync");
const i18n = require("gulp-html-i18n");
const log = require("fancy-log");
const rename = require("gulp-rename");
const reload = browserSync.reload;
const fs = require("fs");
const fetch = require("node-fetch");
const puppeteer = require("puppeteer");
const tap = require("gulp-tap");

require("dotenv").config();

const argv = require("minimist")(process.argv.slice(2));

const PHRASE_API_TOKEN = process.env["PHRASE_API_TOKEN"];
const PHRASE_API_PROJECT_ID = process.env["PHRASE_API_PROJECT_ID"];
const LOCALE_FILENAME = process.env["LOCALE_FILENAME"];
/**
 * mjml -> html -> remove dev comments -> minify |
 * get translations from localise                | -> apply i18n -> emails -> folders grouping (optional)
 */

const basePaths = {
  src: "./emails/",
  subjectsSrc: "./emails/templates/",
  mjmlOutputDest: "./output/mjml/",
  translatedStringsDest: "./output/translations/",
  emailsOutputDest: "./output/emails/",
  prodReadyEmailsDest: "./output/prod/emails/",
  screenshotDest: "./output/screenshots/",
};
const paths = {
  mjml: {
    src: basePaths.src + "templates/**/*.mjml",
    dest: basePaths.mjmlOutputDest,
    includes: basePaths.src + "includes/**/*.mjml",
  },
  i18n: {
    emailsSrc: basePaths.mjmlOutputDest + "**/*.html", // result of mjml
    emailSubjectsSrc: basePaths.subjectsSrc + "**/*.html", // email template subjects
    languagesSrc: basePaths.translatedStringsDest, // downloaded from localize
    dest: basePaths.emailsOutputDest, // final emails
    screenshotsSrc: basePaths.screenshotDest,
  },
  prodDest: basePaths.prodReadyEmailsDest,
};

/** Dev server */
function server(done) {
  let watchDir = paths.i18n.dest;
  // $gulp --mjml
  // will start watch for lokalised emails
  if (argv.mjml) {
    watchDir = paths.mjml.dest;
  }
  const options = {
    server: {
      baseDir: watchDir,
      directory: true,
    },
    port: "8000",
    notify: false,
  };
  browserSync.init(options);
  done();
}

function buildMjmlToHtml() {
  return gulp.src(paths.mjml.src).pipe(mjml()).pipe(gulp.dest(paths.mjml.dest));
}

// prod only task
function buildMjmlToHtmlAndMinify() {
  return (
    gulp
      .src(paths.mjml.src)
      // keepComments config mentioned here https://github.com/mjmlio/mjml/issues/1364
      .pipe(mjml(mjmlEngine, { minify: true, keepComments: false }))
      .pipe(gulp.dest(paths.mjml.dest))
  );
}

function generateLocalizedEmails() {
  // {{ trans('mails.Hi-calendars-1') }}
  const regex = /{{ ?trans\('([\w\-.]+)'\) ?}}/g;
  return gulp
    .src([paths.i18n.emailsSrc])
    .pipe(
      i18n({
        langDir: paths.i18n.languagesSrc,
        langRegExp: regex,
      })
    )
    .pipe(gulp.dest(paths.i18n.dest));
}

function watch() {
  gulp
    .watch([paths.mjml.src, paths.i18n.emailSubjectsSrc])
    .on("change", gulp.series(buildMjmlToHtml, generateLocalizedEmails, reload));
  gulp.watch(paths.mjml.includes).on("change", gulp.series(buildMjmlToHtml, generateLocalizedEmails, reload));
}

async function downloadTranslationsFromPhrase() {
  ["zh-TW", "zh-CN", "en"].forEach(async (locale) => {
    url = new URL(`https://api.phrase.com/v2/projects/${PHRASE_API_PROJECT_ID}/locales/${locale}/download`);

    const params = {
      file_format: "nested_json",
      include_empty_translations: true,
      exclude_empty_zero_forms: false,
      include_translated_keys: true,
      keep_notranslate_tags: false,
      encoding: "UTF-8",
      include_unverified_translations: true,
      fallback_locale_id: "zh-TW",
    };
    const headers = new fetch.Headers();
    url.search = new URLSearchParams(params).toString();
    headers.append("Accept", "*");
    headers.append("Authorization", `token ${PHRASE_API_TOKEN}`);
    const data = await fetch(url, { headers });
    // const json = await data.json();
    const text = await data.text();

    filepath = `${basePaths.translatedStringsDest}${locale}/${LOCALE_FILENAME}`;
    if (!fs.existsSync(path.dirname(filepath))) {
      fs.mkdirSync(path.dirname(filepath), { recursive: true });
    }

    if (fs.exis) console.log(path.dirname(filepath));
    fs.writeFile(filepath, text, (err) => {
      if (err) console.log(err);
    });
  });
}

/**
 * Task will group localized templates of content and subject in one folder per email type.
 */
function groupEmailTemplatesByFolders() {
  return gulp.src(paths.i18n.dest + "**/*.html").pipe(gulp.dest(paths.prodDest));
}

/**
 * Task will build mjml templates.
 * On mjml changes will rebuild mjml and apply translations if any.
 */
gulp.task("default", gulp.series(buildMjmlToHtml, generateLocalizedEmails, gulp.parallel(server, watch)));

/**
 * Task will:
 * 1) build .mjml to .html (minify, remove comments)
 * 2) download translations from Lokalise
 * 3) lokalise all .html files
 * 4) group emails by folders (localized subject and content templates will be in one folder)
 */
gulp.task(
  "prod",
  gulp.series(
    gulp.parallel(buildMjmlToHtmlAndMinify, downloadTranslationsFromPhrase),
    generateLocalizedEmails,
    groupEmailTemplatesByFolders
  )
);

gulp.task("download-translations", downloadTranslationsFromPhrase);

gulp.task("generate-localized-emails", generateLocalizedEmails);

// Will be needed only for upload translation automation.
// gulp.task('translate', uploadTranslationsToLokalise);

gulp.task("folders", groupEmailTemplatesByFolders);

function generateScreenShots() {
  return gulp.src(paths.i18n.dest + "**/*.html").pipe(
    tap(async (file) => {
      try {
        const filename = path.basename(file.basename, ".html") + ".png";
        const exportPath = `${path.dirname(file.path)}/${filename}`;
        console.log(exportPath);
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto("file://" + file.path, { waitUntil: "networkidle0" });
        await page.screenshot({ path: exportPath, fullPage: true });
        await browser.close();
      } catch (err) {
        console.log(err);
      }
    })
  );
}

gulp.task("screenshots", generateScreenShots);

// TODO. 將靜態檔案自動上傳到 AWS S3 上面並且替換成 cloudfront 的路徑
// TODO. 希望可已將 ${{}}$ 的語法替換成 {{ trans('') }}，這樣可以讓後端直接拿來使用！
