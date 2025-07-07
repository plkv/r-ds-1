const gulp = require('gulp');
const sass = require('gulp-sass')(require('sass'));
const concat = require('gulp-concat');
const inlineSource = require('gulp-inline-source');
const htmlmin = require('gulp-htmlmin');
const rimraf = require('rimraf');

const paths = {
  html: 'src/ui/index.html',
  js: 'src/ui/scripts.js',
  scss: 'src/ui/styles/styles.scss',
  css: 'src/ui/styles/',
  dist: 'dist/',
};

gulp.task('clean', function (cb) {
  rimraf.sync(paths.dist);
  cb();
});

gulp.task('styles', () =>
  gulp
    .src(paths.scss)
    .pipe(sass().on('error', sass.logError))
    .pipe(concat('styles.css'))
    .pipe(gulp.dest(paths.css))
);

gulp.task('copy-js', () =>
  gulp.src(paths.js).pipe(gulp.dest(paths.css))
);

gulp.task('build-html', () =>
  gulp
    .src(paths.html)
    .pipe(inlineSource({ rootpath: 'src/ui/styles' }))
    .pipe(htmlmin({ collapseWhitespace: true, removeComments: true }))
    .pipe(gulp.dest(paths.dist))
);

gulp.task('build', gulp.series('clean', 'styles', 'copy-js', 'build-html'));

gulp.task('watch', () => {
  gulp.watch('src/ui/styles/**/*.scss', gulp.series('styles', 'build-html'));
  gulp.watch('src/ui/scripts.js', gulp.series('copy-js', 'build-html'));
  gulp.watch('src/ui/index.html', gulp.series('build-html'));
}); 