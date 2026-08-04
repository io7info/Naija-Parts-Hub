# Seed listing photos (optional override)

The seeder reads product photography from the committed design assets in
`apps/web/public/products/` by default, so **a fresh clone seeds with real
photos and needs nothing in this directory**.

Drop files here only to override those with your own fixtures. Anything here
wins over `public/products`. Accepted names per listing:

| Name(s)                          | Listing                               |
| -------------------------------- | ------------------------------------- |
| `brake-pads` / `brake-pad`       | Toyota Camry 2017 Front Brake Pads    |
| `alternator`                     | Honda Accord 2013 Alternator          |
| `clutch-plates` / `clutch-plate` | Mack Truck Heavy Duty Clutch Plate    |
| `hydraulic-pump`                 | Caterpillar Excavator Hydraulic Pump  |
| `fuel-filter` / `oil-filter`     | Massey Ferguson Tractor Fuel Filter   |
| `headlight`                      | Toyota Corolla LED Headlight Assembly |
| `tractor-tyre` / `tractor-tire`  | 710/70R42 Tractor Rear Tyre           |

`.jpg`, `.jpeg`, `.png` and `.webp` all work. Files are re-encoded to JPEG and
resized to 1200px on the long edge, keeping every upload under the 512 KB
ceiling the Storage rules enforce.

Any listing with no matching file falls back to a generated colour tile.

Files placed here are gitignored — they are your local fixtures, not project
assets.
