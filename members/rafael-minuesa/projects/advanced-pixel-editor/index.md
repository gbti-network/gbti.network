---
title: 'Advanced Pixel Editor: Edit Media Library Images Without Leaving WordPress'
slug: advanced-pixel-editor
shortDescription: >-
  A WordPress plugin that edits Media Library images inside the dashboard, with ImageMagick doing
  the work on the server. It covers contrast and sharpening against a live before and after slider,
  crop, resize, rotate and flip, and an AI edit from a written prompt through the provider already
  connected to WordPress.
categories:
  - devops
  - frameworks
  - wordpress
status: published
visibility: public
publicStub: false
pricing: free
version: 3.8.0
license: GPL-2.0
licenseUrl: https://www.gnu.org/licenses/gpl-2.0.html
requires: WordPress 5.6+, PHP 7.4+
tags:
  - wordpress
  - image-editing
  - imagemagick
  - media-library
  - photo-editor
  - ai
  - accessibility
  - open-source
platforms:
  - WordPress
icon: ./images/ape-icon-128.webp
featuredImage: ./images/ape-featured.webp
banner: ./images/banner-1544x500.png
gallery:
  - src: ./images/ape-editor.webp
    caption: >-
      Contrast against a live before and after slider, dragged to compare the edit with the
      original.
  - src: ./images/ape-crop.webp
    caption: Crop with an interactive overlay and aspect presets, beside resize and DPI.
  - src: ./images/ape-media-library.webp
    caption: >-
      The Advanced Editor button sits next to Edit Image on the attachment page, and in both Media
      Library views.
  - src: ./images/ape-filters.webp
    caption: >-
      The Advanced Filters panel in the Pro add-on, with sepia and vignette shown alongside
      brightness, saturation, hue, auto levels, blur, noise reduction and emboss.
sidebarPosition: right
links:
  - type: repository
    url: https://github.com/rafael-minuesa/advanced-pixel-editor
    label: Source on GitHub
  - type: download
    url: https://wordpress.org/plugins/advanced-pixel-editor/
    label: WordPress.org
  - type: support
    url: https://wordpress.org/support/plugin/advanced-pixel-editor/
    label: Support forum
updatedAt: '2026-10-13T21:56:59.772Z'
publishedAt: '2026-10-13T21:57:00.349Z'
type: project
author: rafael-minuesa
---

Advanced Pixel Editor edits the images already in a WordPress Media Library without leaving the
dashboard. Pick an image, move a slider, and ImageMagick renders the result on the server and sends
back a preview.

## Image editing inside the WordPress Media Library

ImageMagick renders every adjustment on the server rather than in the browser, so the preview is the
file that will be saved. The editor opens from the Media Library grid, the list view, or any
attachment edit screen, and the image loads straight into it. JPEG, PNG, GIF and WebP are supported,
up to 10 MB and 4096 by 4096 pixels by default.

## Sigmoidal contrast and unsharp mask sharpening

Contrast uses a sigmoidal curve, which lifts midtones while holding the ends of the range, and
sharpening is an unsharp mask with separate amount, radius and threshold controls. Both are the
algorithms Photoshop and Lightroom use for the same two jobs. A draggable comparison slider sits over
the preview, so an edit is judged against the original rather than from memory.

## Crop, resize and DPI in the same panel

Crop uses an interactive overlay with free, 1:1, 4:3 and 16:9 presets. Resize holds the aspect ratio
unless told otherwise, DPI is set alongside it, and rotation offers 45 and 90 degree steps as well as
a free angle. Horizontal and vertical flips are one click each.

## AI image editing from a text prompt

On WordPress 7.0 or newer, an image can be edited by describing the change, for example replacing a
sky with a sunset. The request goes to whichever AI provider is already connected under Settings and
Connectors, an OpenAI or Google key, so the plugin adds no account and no bill of its own: the
provider charges for its own usage. The result can be refined with another prompt, adjusted with the
ordinary sliders, and saved like any other edit.

## Automatic backup and one-click restore

Saving defaults to a new file, which leaves the original untouched. Replacing the original is the
other option, and it writes an automatic backup first, so the original is one click away afterwards.
The editor is keyboard navigable, carries ARIA labels and screen reader support, and the comparison
slider works on touch.

## Advanced Pixel Editor Pro filters, watermarks and batches

The Pro add-on adds filters, watermarking and batch processing to the same editor. Filters cover
brightness, saturation, hue, auto levels, sepia, vignette, Gaussian blur, noise reduction and emboss,
each with the same live preview. Watermarking takes text or an image from the Media Library, with
size, colour, opacity, rotation, a nine point position grid and tiling. Batch processing applies
contrast, sharpness, brightness, saturation and hue across many images at once.

## WordPress 5.6 and PHP 7.4 requirements

WordPress 5.6 or later and PHP 7.4 or later, tested to WordPress 7.1.3. The AI edit is the one feature
with a higher floor, since it needs WordPress 7.0 and a connected provider. Version 3.8.0, released
under GPLv2 or later, with the source on GitHub.
