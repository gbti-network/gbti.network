---
title: 'Empirical Responsive Images: Auto Image Sizes, WebP and AVIF for WordPress'
slug: empirical-responsive-images
shortDescription: >-
  Fix oversized images with zero setup. Automatically creates the image sizes, thumbnails, WebP and
  AVIF your pages need, in the background.
categories:
  - devops
  - frameworks
  - wordpress
status: draft
visibility: public
pricing: free
version: 0.3.16
license: GPL-2.0-or-later
licenseUrl: https://www.gnu.org/licenses/gpl-2.0.html
requires: WordPress 6.9+, PHP 7.4+
icon: ./images/empirical-responsive-images-icon.png
featuredImage: ./images/empirical-responsive-images-cover.png
banner: ./images/empirical-responsive-images-banner.png
gallery:
  - src: ./images/empirical-responsive-images-screenshot-2.png
    caption: >-
      A large photo in a small phone slot wastes most of its pixels. The plugin creates the size
      that fits.
  - src: ./images/empirical-responsive-images-screenshot-3.png
    caption: The image size your layout needs but WordPress never made. The plugin makes it for you.
  - src: ./images/empirical-responsive-images-screenshot-4.png
    caption: >-
      Mobile Lighthouse and PageSpeed result on one test page before and after right-sized images.
      Scores vary by site and test run.
  - src: ./images/empirical-responsive-images-screenshot-5.png
    caption: 'Optional status page: totals and WebP/AVIF support, with nothing for you to do.'
sidebarPosition: right
links:
  - type: download
    url: https://wordpress.org/plugins/empirical-responsive-images/
    label: Download on WordPress.org
  - type: repository
    url: https://github.com/gsusI/empirical-responsive-images
    label: View on GitHub
publishedAt: '2026-11-03T16:48:04.362Z'
updatedAt: '2026-11-03T16:48:04.044Z'
type: project
author: gsusi
---

Empirical Responsive Images finds the images a WordPress site sends too large for the space they fill, then creates the sizes that actually fit. Activate it and that's it: there is nothing to configure, no bulk regeneration to run, no queue to approve, and no account or API key.

## The problem it solves

WordPress can only offer the thumbnail sizes it already has. When none of them is close to the slot an image is shown in, phones end up downloading images made for desktops. PageSpeed Insights flags this as "Improve image delivery" or "Properly size images", and it can hold back Largest Contentful Paint (LCP).

Other tools ask you to guess which sizes you need. This one measures them on your real pages and only creates the sizes your layouts use.

## How it works

1. A small browser check compares each displayed image with the sizes already available. Images with a good match are ignored.
2. A missing size has to be confirmed before any work is scheduled. By default, regular visitors confirm it across three separate 15-minute periods.
3. WordPress creates the new files later as a background task, up to 50 image jobs a day.
4. The normal responsive image markup (srcset and sizes) picks them up, and the page cache is refreshed.

Nothing is resized in the visitor's browser, and no image is generated while a visitor waits for the page.

## What you get

- Missing thumbnail sizes created automatically, without regenerating the whole media library
- WebP and AVIF versions when the server's image library supports them, kept alongside the originals
- Coverage for Media Library images and local theme and plugin images
- Cache refresh for WP Rocket, W3 Total Cache, WP Super Cache, LiteSpeed Cache, Breeze, Autoptimize and SiteGround Speed Optimizer
- Works with lazy loading, page builders and WooCommerce galleries that output normal WordPress image elements
- Optional status tables under Tools > Responsive Images, plus WP-CLI commands to list learned sizes or force a rebuild

Custom crops, image choices and picture layouts stay as they are. The plugin fills proven gaps rather than replacing WordPress responsive images.

## Privacy and limits

Everything stays on your site: no images are sent to a CDN or an outside image service. Reports carry only a code for a local image and a rounded missing size, without the page URL, visitor identity, IP address or browser details. Visitors can't submit arbitrary image URLs or invent sizes, and hard limits on requests, queued jobs, retries, daily work and free disk space keep generation bounded.

## Result

On one test page, the mobile PageSpeed score went from 75 to 99 and LCP improved from 7.2 s to 2.3 s. Results depend on the theme, original images, cache and hosting, so no score is guaranteed.

Free and open source under GPLv2 or later. Requires WordPress 6.9+ and PHP 7.4+.
