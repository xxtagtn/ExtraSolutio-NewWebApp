# Seasonal Artwork

Christmas and Easter decorations follow the approved **Luz & Pinho** and
**Grinalda de Pascoa** concepts. They were isolated as transparent PNG artwork
with the built-in image-generation tool, using the approved mockups as references.
No interface text, logo or controls are baked into the artwork.

Both files are 1774 x 887 pixels. CSS crops the three compositions without
stretching them, using the following source rectangles (x, y, width, height):

| File | Header | Sidebar | Public Footer |
| --- | --- | --- | --- |
| christmas-decorations.png | 0, 0, 1774, 400 | 0, 340, 480, 547 | 480, 500, 1294, 387 |
| easter-garland.png | 0, 0, 1774, 610 | 0, 515, 515, 372 | 550, 610, 1224, 277 |

Desktop headers have dedicated shallow garlands, rather than magnifying the
compact mobile corner artwork. These transparent files are 2172 x 724 pixels:

| File | Source Rectangle |
| --- | --- |
| christmas-header.png | 0, 230, 2172, 260 |
| easter-header.png | 0, 200, 2172, 350 |

They use the same approved reference images and a brief specifying long, low
garlands with fully visible small hanging ornaments. Mobile headers retain the
corner composition. Text backdrops protect readability without darkening all
the surrounding artwork.

The header's alpha mask excludes the sidebar composition on the left of each
atlas, with a soft transition instead of a visibly straight cut.
The footer stays horizontal and centered instead of reusing a square sidebar
illustration. Repeated sidebar-edge art and KPI-corner decorations remain
exclusive to Halloween. Original and Halloween artwork is unchanged.

Generation brief: preserve the approved reference decorations, remove all UI,
use transparent negative space, and supply header, sidebar and footer pieces.
Christmas retains pine, burgundy velvet ribbons, glass baubles, gold stars and
warm lights. Easter retains slender sage leaves, ivory flowers, pink bows and
small hanging pastel ornaments, with no characters or animals.
