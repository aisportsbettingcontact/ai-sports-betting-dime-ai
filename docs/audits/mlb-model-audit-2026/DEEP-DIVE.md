# Deep Dive — per-market, per-series, per-slice (generated 2026-07-25T20:53:36.130Z)

Series: live = as published; p1 = fixed model raw; p2 = monthly walk-forward calibration; p2d = per-slate (daily) walk-forward calibration.

## fg_ml

| series | n | hit | brier | bias | mae | pick-CLV |
|---|---|---|---|---|---|---|
| live | 1528 | 0.5524±0.0249 | 0.24722 | - | - | -0.0002±0.0002 |
| p1 | 1545 | 0.554±0.0248 | 0.24704 | - | - | -0.0002±0.0002 |
| p2 | 1545 | 0.554±0.0248 | 0.24703 | - | - | -0.0002±0.0002 |

live slices: mo_2026-03(n=75 hit=0.6133 br=0.23988) · mo_2026-04(n=386 hit=0.5311 br=0.2485) · mo_2026-05(n=402 hit=0.5697 br=0.2462) · mo_2026-06(n=392 hit=0.5536 br=0.24653) · mo_2026-07(n=273 hit=0.5385 br=0.24991) · home_fav(n=866 hit=0.5727 br=0.24518) · away_fav(n=662 hit=0.5257 br=0.24988) · day(n=555 hit=0.5532 br=0.24638) · night(n=973 hit=0.5519 br=0.24769)

p2 slices: mo_2026-03(n=76 hit=0.5658 br=0.24205) · mo_2026-04(n=389 hit=0.545 br=0.25127) · mo_2026-05(n=416 hit=0.5625 br=0.24558) · mo_2026-06(n=392 hit=0.5612 br=0.24587) · mo_2026-07(n=272 hit=0.5404 br=0.24626) · home_fav(n=865 hit=0.5699 br=0.24456) · away_fav(n=668 hit=0.5344 br=0.25009) · day(n=563 hit=0.5666 br=0.247) · night(n=982 hit=0.5468 br=0.24706)

reliability (headline replay): 0.3698->0.4037(n161) 0.4545->0.4638(n1145) 0.5224->0.6099(n223)

## fg_rl

| series | n | hit | brier | bias | mae | pick-CLV |
|---|---|---|---|---|---|---|
| live | 1528 | 0.5877±0.0247 | - | -0.3427±0.2295 | 3.5629 | -0.0067±0.0028 |
| p1 | 1545 | 0.5851±0.0246 | 0.24169 | -0.3715±0.2294 | 3.5649 | -0.0051±0.0028 |
| p2 | 1545 | 0.5851±0.0246 | 0.24169 | -0.3788±0.2294 | 3.5646 | -0.0051±0.0028 |

live slices: mo_2026-03(n=75 hit=0.56 bias=-0.26) · mo_2026-04(n=386 hit=0.5466 bias=-0.2883) · mo_2026-05(n=402 hit=0.6294 bias=-0.2696) · mo_2026-06(n=392 hit=0.6097 bias=-0.4771) · mo_2026-07(n=273 hit=0.5604 bias=-0.357) · home_fav(n=866 hit=0.5947 bias=-0.1414) · away_fav(n=662 hit=0.5785 bias=-0.606) · day(n=555 hit=0.591 bias=-0.1921) · night(n=973 hit=0.5858 bias=-0.4286)

p2 slices: mo_2026-03(n=76 hit=0.5658 bias=-0.1732 br=0.24978) · mo_2026-04(n=389 hit=0.5656 bias=-0.3414 br=0.24828) · mo_2026-05(n=416 hit=0.6034 bias=-0.3493 br=0.23456) · mo_2026-06(n=392 hit=0.6071 bias=-0.4858 br=0.23821) · mo_2026-07(n=272 hit=0.5588 bias=-0.3806 br=0.24596) · home_fav(n=865 hit=0.6012 bias=-0.12 br=0.23943) · away_fav(n=668 hit=0.5689 bias=-0.6817 br=0.24376) · day(n=563 hit=0.5808 bias=-0.2285 br=0.24435) · night(n=982 hit=0.5876 bias=-0.4649 br=0.24017)

reliability (headline replay): 0.2831->0.283(n53) 0.3542->0.396(n447) 0.4442->0.5088(n285) 0.5567->0.5872(n516) 0.6275->0.6307(n241)

## fg_total

| series | n | hit | brier | bias | mae | pick-CLV |
|---|---|---|---|---|---|---|
| live | 1528 | 0.5215±0.0256 | 0.25386 | -0.5436±0.2251 | 3.5187 | 0.0001±0.0004 |
| p1 | 1545 | 0.5455±0.0254 | 0.24865 | -0.236±0.2218 | 3.5039 | -0.0001±0.0004 |
| p2 | 1545 | 0.5496±0.0253 | 0.24863 | -0.0521±0.2223 | 3.531 | -0.0001±0.0004 |

live slices: mo_2026-03(n=73 hit=0.6438 bias=-0.48 br=0.23303) · mo_2026-04(n=367 hit=0.4905 bias=-0.864 br=0.25726) · mo_2026-05(n=384 hit=0.5156 bias=-0.1324 br=0.25547) · mo_2026-06(n=376 hit=0.5346 bias=-0.693 br=0.25287) · mo_2026-07(n=267 hit=0.5206 bias=-0.4991 br=0.25398) · home_fav(n=825 hit=0.5127 bias=-0.729 br=0.256) · away_fav(n=642 hit=0.5327 bias=-0.3011 br=0.25112) · day(n=531 hit=0.5047 bias=-0.5729 br=0.25864) · night(n=936 hit=0.531 bias=-0.5269 br=0.25115) · line_low(n=383 hit=0.517 bias=-0.5944 br=0.25296) · line_mid(n=820 hit=0.528 bias=-0.4847 br=0.25197) · line_high(n=264 hit=0.5076 bias=-0.6557 br=0.26105)

p2 slices: mo_2026-03(n=73 hit=0.589 bias=-0.1338 br=0.24368) · mo_2026-04(n=370 hit=0.5027 bias=-0.4456 br=0.2557) · mo_2026-05(n=398 hit=0.5704 bias=0.5555 br=0.2468) · mo_2026-06(n=376 hit=0.5691 bias=-0.3021 br=0.24373) · mo_2026-07(n=266 hit=0.5451 bias=-0.0357 br=0.24984) · home_fav(n=824 hit=0.5413 bias=-0.241 br=0.24984) · away_fav(n=647 hit=0.5595 bias=0.1896 br=0.24763) · day(n=539 hit=0.5343 bias=-0.1129 br=0.2496) · night(n=944 hit=0.5583 bias=-0.0173 br=0.24808) · line_low(n=384 hit=0.5469 bias=0.0063 br=0.25067) · line_mid(n=820 hit=0.5463 bias=-0.0608 br=0.2478) · line_high(n=267 hit=0.5618 bias=-0.1162 br=0.24959)

reliability (headline replay): 0.3674->0.4494(n158) 0.4549->0.4577(n686) 0.5381->0.5606(n528) 0.6295->0.5341(n88)

## f5_ml

| series | n | hit | brier | bias | mae | pick-CLV |
|---|---|---|---|---|---|---|
| live | 1527 | 0.5376±0.0272 | 0.24915 | - | - | - |
| p1 | 1545 | 0.541±0.027 | 0.24758 | - | - | - |
| p2 | 1545 | 0.541±0.027 | 0.24671 | - | - | - |

live slices: mo_2026-03(n=61 hit=0.5246 br=0.25365) · mo_2026-04(n=325 hit=0.5538 br=0.25027) · mo_2026-05(n=347 hit=0.5591 br=0.2457) · mo_2026-06(n=327 hit=0.526 br=0.25065) · mo_2026-07(n=231 hit=0.5022 br=0.24942) · home_fav(n=736 hit=0.5598 br=0.24747) · away_fav(n=555 hit=0.5081 br=0.25136) · day(n=461 hit=0.5445 br=0.24832) · night(n=830 hit=0.5337 br=0.24961)

p2 slices: mo_2026-03(n=62 hit=0.5161 br=0.25057) · mo_2026-04(n=327 hit=0.5505 br=0.24561) · mo_2026-05(n=358 hit=0.5447 br=0.24714) · mo_2026-06(n=327 hit=0.5321 br=0.24776) · mo_2026-07(n=231 hit=0.5411 br=0.24509) · home_fav(n=736 hit=0.5476 br=0.24457) · away_fav(n=559 hit=0.5367 br=0.24936) · day(n=469 hit=0.5437 br=0.24475) · night(n=836 hit=0.5395 br=0.24781)

reliability (headline replay): 0.3726->0.3622(n185) 0.4468->0.4797(n1036) 0.5171->0.5897(n78)

## f5_rl

| series | n | hit | brier | bias | mae | pick-CLV |
|---|---|---|---|---|---|---|
| live | 837 | 0.4767±0.0339 | 0.25469 | - | - | - |
| p1 | 838 | 0.5036±0.0339 | 0.25783 | - | - | - |
| p2 | 838 | 0.5036±0.0339 | 0.25783 | - | - | - |

live slices: mo_2026-03(n=66 hit=0.4394 br=0.26351) · mo_2026-04(n=315 hit=0.454 br=0.25744) · mo_2026-05(n=277 hit=0.4982 br=0.25031) · mo_2026-07(n=155 hit=0.4968 br=0.25422) · home_fav(n=488 hit=0.4816 br=0.25338) · away_fav(n=349 hit=0.4699 br=0.25652) · day(n=337 hit=0.4748 br=0.25288) · night(n=500 hit=0.478 br=0.25591)

p2 slices: mo_2026-03(n=67 hit=0.5522 br=0.25535) · mo_2026-04(n=315 hit=0.4794 br=0.2606) · mo_2026-05(n=277 hit=0.4874 br=0.26248) · mo_2026-07(n=155 hit=0.5484 br=0.24739) · home_fav(n=488 hit=0.5328 br=0.24936) · away_fav(n=350 hit=0.4629 br=0.26964) · day(n=337 hit=0.5163 br=0.25718) · night(n=501 hit=0.495 br=0.25826)

reliability (headline replay): 0.4793->0.4902(n51) 0.5588->0.507(n499) 0.6303->0.4982(n285)

## f5_total

| series | n | hit | brier | bias | mae | pick-CLV |
|---|---|---|---|---|---|---|
| live | 838 | 0.5119±0.0339 | 0.2536 | -0.3085±0.2124 | 2.4827 | - |
| p1 | 839 | 0.503±0.0339 | 0.25253 | -0.2386±0.2116 | 2.4792 | - |
| p2 | 839 | 0.5077±0.0338 | 0.25195 | -0.1429±0.2119 | 2.4896 | - |

live slices: mo_2026-03(n=67 hit=0.5075 bias=-0.2239 br=0.25509) · mo_2026-04(n=315 hit=0.5016 bias=-0.4222 br=0.2518) · mo_2026-05(n=277 hit=0.5199 bias=-0.3285 br=0.25433) · mo_2026-07(n=155 hit=0.5484 bias=0.1065 br=0.25166) · home_fav(n=489 hit=0.501 bias=-0.4785 br=0.25665) · away_fav(n=349 hit=0.5272 bias=-0.0702 br=0.24932) · day(n=337 hit=0.5104 bias=-0.2478 br=0.25561) · night(n=501 hit=0.513 bias=-0.3493 br=0.25225) · line_low(n=197 hit=0.5635 bias=0.2995 br=0.25141) · line_mid(n=499 hit=0.491 bias=-0.3447 br=0.25454) · line_high(n=142 hit=0.5141 bias=-1.0246 br=0.25332)

p2 slices: mo_2026-03(n=68 hit=0.4118 bias=-0.2155 br=0.25618) · mo_2026-04(n=315 hit=0.4921 bias=-0.3399 br=0.25672) · mo_2026-05(n=277 hit=0.5451 bias=-0.008 br=0.24678) · mo_2026-07(n=155 hit=0.5226 bias=0.2167 br=0.24758) · home_fav(n=489 hit=0.4785 bias=-0.3167 br=0.25547) · away_fav(n=350 hit=0.5486 bias=0.1 br=0.24703) · day(n=337 hit=0.4807 bias=-0.0725 br=0.25382) · night(n=502 hit=0.5259 bias=-0.1901 br=0.25069) · line_low(n=198 hit=0.4596 bias=0.5544 br=0.25457) · line_mid(n=499 hit=0.5251 bias=-0.1847 br=0.25083) · line_high(n=142 hit=0.5141 bias=-0.968 br=0.25222)

reliability (headline replay): 0.3663->0.4453(n137) 0.4498->0.5096(n471) 0.5337->0.5024(n207)

## nrfi_yrfi

| series | n | hit | brier | bias | mae | pick-CLV |
|---|---|---|---|---|---|---|
| live | 1527 | 0.5147±0.0251 | 0.25004 | - | - | - |
| p1 | 1545 | 0.5333±0.0249 | 0.24869 | - | - | - |
| p2 | 1545 | 0.534±0.0249 | 0.24852 | - | - | - |

live slices: mo_2026-03(n=75 hit=0.4933 br=0.25288) · mo_2026-04(n=386 hit=0.5492 br=0.24521) · mo_2026-05(n=402 hit=0.5025 br=0.25013) · mo_2026-06(n=392 hit=0.5102 br=0.25304) · mo_2026-07(n=272 hit=0.4963 br=0.25165) · home_fav(n=865 hit=0.5017 br=0.25171) · away_fav(n=662 hit=0.5317 br=0.24786) · day(n=555 hit=0.5153 br=0.24742) · night(n=972 hit=0.5144 br=0.25154)

p2 slices: mo_2026-03(n=76 hit=0.5395 br=0.25007) · mo_2026-04(n=389 hit=0.5527 br=0.24813) · mo_2026-05(n=416 hit=0.5024 br=0.25332) · mo_2026-06(n=392 hit=0.5587 br=0.24513) · mo_2026-07(n=272 hit=0.5184 br=0.24621) · home_fav(n=865 hit=0.5237 br=0.25023) · away_fav(n=668 hit=0.5449 br=0.24628) · day(n=563 hit=0.5417 br=0.24776) · night(n=982 hit=0.5295 br=0.24896)

reliability (headline replay): 0.3666->0.283(n53) 0.4676->0.4515(n454) 0.5419->0.5169(n979) 0.6167->0.5357(n56)

## k_prop

| series | n | hit | brier | bias | mae | pick-CLV |
|---|---|---|---|---|---|---|
| live | 2686 | 0.5257±0.0189 | 0.29965 | -1.0192±0.0988 | 2.2012 | - |
| p1 | 3090 | 0.5908±0.0192 | 0.25799 | 0.6469±0.0987 | 2.2436 | - |
| p2 | 3090 | 0.5908±0.0192 | 0.26384 | 0.1133±0.0967 | 2.1361 | - |

live slices: mo_2026-03(n=107 hit=0.4393 bias=-0.923 br=0.31166) · mo_2026-04(n=622 hit=0.5209 bias=-0.422 br=0.28615) · mo_2026-05(n=671 hit=0.5186 bias=-1.1664 br=0.30004) · mo_2026-06(n=755 hit=0.5338 bias=-1.3065 br=0.31152) · mo_2026-07(n=529 hit=0.5463 bias=-1.1452 br=0.29567) · home_fav(n=1517 hit=0.526 bias=-1.0332 br=0.30014) · away_fav(n=1167 hit=0.5253 bias=-1.0011 br=0.29902) · day(n=967 hit=0.5305 bias=-0.8544 br=0.2906) · night(n=1717 hit=0.523 bias=-1.1119 br=0.30475) · hand_L(n=655 hit=0.5115 bias=-1.0962 br=0.31228) · hand_R(n=1737 hit=0.5135 bias=-1.1695 br=0.3033) · line_le5(n=1542 hit=0.487 bias=-1.3534 br=0.32455) · line_gt5(n=1142 hit=0.5779 bias=-0.5682 br=0.26603) · pick_OVER(n=368 hit=0.5054 bias=0.9282 br=0.28287) · pick_UNDER(n=2316 hit=0.5289 bias=-1.3284 br=0.30232)

p2 slices: mo_2026-03(n=106 hit=0.434 bias=0.8733 br=0.29887) · mo_2026-04(n=541 hit=0.5139 bias=0.8752 br=0.30593) · mo_2026-05(n=677 hit=0.6307 bias=-0.1817 br=0.24286) · mo_2026-06(n=703 hit=0.6188 bias=-0.2626 br=0.25304) · mo_2026-07(n=495 hit=0.6141 bias=-0.1957 br=0.25439) · home_fav(n=1433 hit=0.589 bias=0.0781 br=0.26553) · away_fav(n=1089 hit=0.5932 bias=0.1581 br=0.26162) · day(n=939 hit=0.5932 bias=0.1879 br=0.2557) · night(n=1583 hit=0.5894 bias=0.0706 br=0.26867) · hand_L(n=680 hit=0.5868 bias=0.3125 br=0.26827) · hand_R(n=1794 hit=0.5881 bias=0.0116 br=0.2636) · line_le5(n=1446 hit=0.5864 bias=-0.2122 br=0.26851) · line_gt5(n=1076 hit=0.5967 bias=0.132 br=0.25757) · pick_OVER(n=1041 hit=0.5927 bias=1.2318 br=0.26522) · pick_UNDER(n=1481 hit=0.5895 bias=-0.9781 br=0.26288)

reliability (headline replay): 0.0497->0.2756(n283) 0.1526->0.3899(n318) 0.2495->0.3673(n324) 0.3492->0.5017(n289) 0.4482->0.5318(n267) 0.5497->0.5022(n231) 0.6494->0.5952(n252) 0.7511->0.5681(n213) 0.8509->0.4032(n186) 0.9423->0.1321(n159)

## hr_prop

| series | n | hit | brier | bias | mae | pick-CLV |
|---|---|---|---|---|---|---|
| live | 9143 | 0.0927±0.0234 | 0.09905 | - | - | - |
| p1 | 27810 | - | 0.09687 | - | - | - |
| p2 | 27810 | - | 0.09685 | - | - | - |

live slices: mo_2026-03(n=168 hit=0.0833 br=0.09514) · mo_2026-04(n=390 hit=0.1051 br=0.09315) · mo_2026-05(n=24 hit=0 br=0.09613) · mo_2026-06(n=2 hit=0 br=0.11573) · mo_2026-07(n=9 hit=0 br=0.10418) · home_fav(n=320 hit=0.0969 br=0.10286) · away_fav(n=273 hit=0.0879 br=0.09406) · day(n=307 hit=0.0879 br=0.09352) · night(n=286 hit=0.0979 br=0.1032) · park_hr_low(n=122 hit=0.1311 br=0.10187) · park_hr_mid(n=243 hit=0.0864 br=0.0936) · park_hr_high(n=228 hit=0.0789 br=0.10203)

p2 slices: mo_2026-03(n=0 br=0.09439) · mo_2026-04(n=0 br=0.0924) · mo_2026-05(n=0 br=0.09041) · mo_2026-06(n=0 br=0.10419) · mo_2026-07(n=0 br=0.1032) · home_fav(n=0 br=0.09849) · away_fav(n=0 br=0.09471) · day(n=0 br=0.09534) · night(n=0 br=0.09772) · park_hr_low(n=0 br=0.09342) · park_hr_mid(n=0 br=0.09469) · park_hr_high(n=0 br=0.10245)

reliability (headline replay): 0.0645->0.0823(n14135) 0.1376->0.1275(n11802) 0.2332->0.2018(n1700) 0.3299->0.2256(n164)

## K props — largest per-pitcher residuals (headline replay, n>=5)
- Mason Montgomery: bias 4.686 (mae 4.686, n=5)
- Braydon Fisher: bias 3.5801 (mae 3.8696, n=7)
- Bryan Hudson: bias 3.2093 (mae 3.2093, n=6)
- Garrett Crochet: bias 2.7937 (mae 3.7727, n=6)
- Huascar Brazobán: bias 2.2665 (mae 2.2665, n=6)
- Troy Melton: bias -2.2251 (mae 3.0718, n=9)
- Cristopher Sánchez: bias 2.1892 (mae 2.7532, n=21)
- Max Fried: bias 2.1169 (mae 2.6622, n=11)
- Tyler Glasnow: bias 2.0107 (mae 2.4164, n=7)
- Hunter Brown: bias 1.9445 (mae 2.1818, n=8)
- Michael Soroka: bias 1.8507 (mae 2.8134, n=15)
- Robert Gasser: bias -1.8189 (mae 2.0909, n=10)
- Roki Sasaki: bias -1.8175 (mae 2.5477, n=18)
- Carmen Mlodzinski: bias 1.7123 (mae 2.6517, n=9)
- Tatsuya Imai: bias -1.6921 (mae 3.449, n=14)
- Matthew Liberatore: bias -1.6689 (mae 2.4639, n=20)
- Brandon Sproat: bias -1.6277 (mae 2.2744, n=16)
- Trey Gibson: bias -1.591 (mae 3.3664, n=7)
- Gerrit Cole: bias -1.558 (mae 2.7573, n=11)
- Kris Bubic: bias 1.5293 (mae 3.0051, n=9)

## NRFI logistic betas (last fit per month)

