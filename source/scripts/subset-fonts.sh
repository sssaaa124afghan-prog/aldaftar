#!/bin/sh
# Re-creates src/assets/fonts/designs/*.woff2 from @fontsource (needs fonttools + brotli). Arabic = letters, harakat, digits; Latin = Basic Latin.
set -e
F=node_modules/@fontsource; O=src/assets/fonts/designs; mkdir -p $O
AR="U+0600-0652,U+0660-066D,U+0670,U+06A9,U+06AF,U+06CC,U+200C-200F,U+FEFF"
LA="U+0020-007E,U+00A0,U+00B0,U+00B7,U+00D7,U+2009,U+2013,U+2014,U+2018-201D,U+2022,U+2026,U+2066-2069,U+2212"
NUM="U+0020-0040,U+0041-005A,U+0061,U+0063,U+0065,U+0067,U+006B,U+006C,U+006D,U+0073,U+0078,U+00A0,U+00B7,U+00D7,U+2013,U+2212"
s(){ pyftsubset "$F/$1.woff2" --unicodes="$2" --flavor=woff2 --layout-features="$4" --no-hinting --output-file="$O/$3.woff2"; }
s ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal "$AR" plexar-400 '*'
s ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-600-normal "$AR" plexar-600 '*'
s ibm-plex-sans/files/ibm-plex-sans-latin-400-normal "$LA" plex-400 'kern,liga,tnum,lnum,calt'
s ibm-plex-sans/files/ibm-plex-sans-latin-600-normal "$LA" plex-600 'kern,liga,tnum,lnum,calt'
s alexandria/files/alexandria-arabic-400-normal "$AR" alex-400 '*'
s alexandria/files/alexandria-arabic-700-normal "$AR" alex-700 '*'
s alexandria/files/alexandria-latin-400-normal "$LA" alexl-400 'kern,liga,tnum,lnum,calt'
s barlow-condensed/files/barlow-condensed-latin-700-normal "$NUM" bc-700 'kern,liga,tnum,lnum,calt'
s barlow-semi-condensed/files/barlow-semi-condensed-latin-600-normal "$NUM" bsc-600 'kern,liga,tnum,lnum,calt'
