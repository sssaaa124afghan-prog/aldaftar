# Contrast + CIEDE2000 checks for the macro colours and text tokens of designs A/B/C/classic.
import itertools, math, sys
def hx(c): c=c.lstrip('#'); return [int(c[i:i+2],16)/255 for i in (0,2,4)]
def lin(v): return v/12.92 if v<=0.04045 else ((v+0.055)/1.055)**2.4
def L(c): r,g,b=[lin(x) for x in hx(c)]; return 0.2126*r+0.7152*g+0.0722*b
def cr(a,b): la,lb=sorted([L(a),L(b)],reverse=True); return (la+0.05)/(lb+0.05)
def lab(c):
  r,g,b=[lin(x) for x in hx(c)]
  X=(0.4124*r+0.3576*g+0.1805*b)/0.95047; Y=0.2126*r+0.7152*g+0.0722*b; Z=(0.0193*r+0.1192*g+0.9505*b)/1.08883
  f=lambda t: t**(1/3) if t>0.008856 else 7.787*t+16/116
  return 116*f(Y)-16, 500*(f(X)-f(Y)), 200*(f(Y)-f(Z))
def de2000(c1,c2):
  L1,a1,b1=lab(c1); L2,a2,b2=lab(c2)
  C1=math.hypot(a1,b1); C2=math.hypot(a2,b2); Cb=(C1+C2)/2
  G=0.5*(1-math.sqrt(Cb**7/(Cb**7+25**7))); a1p=(1+G)*a1; a2p=(1+G)*a2
  C1p=math.hypot(a1p,b1); C2p=math.hypot(a2p,b2)
  h1=math.degrees(math.atan2(b1,a1p))%360; h2=math.degrees(math.atan2(b2,a2p))%360
  dL=L2-L1; dC=C2p-C1p; dh=h2-h1
  if C1p*C2p==0: dh=0
  elif dh>180: dh-=360
  elif dh<-180: dh+=360
  dH=2*math.sqrt(C1p*C2p)*math.sin(math.radians(dh/2))
  Lb=(L1+L2)/2; Cbp=(C1p+C2p)/2
  hb=(h1+h2)/2 if abs(h1-h2)<=180 else (h1+h2+360)/2
  if C1p*C2p==0: hb=h1+h2
  T=1-0.17*math.cos(math.radians(hb-30))+0.24*math.cos(math.radians(2*hb))+0.32*math.cos(math.radians(3*hb+6))-0.2*math.cos(math.radians(4*hb-63))
  Sl=1+0.015*(Lb-50)**2/math.sqrt(20+(Lb-50)**2); Sc=1+0.045*Cbp; Sh=1+0.015*Cbp*T
  Rt=-2*math.sqrt(Cbp**7/(Cbp**7+25**7))*math.sin(math.radians(60*math.exp(-((hb-275)/25)**2)))
  return math.sqrt((dL/Sl)**2+(dC/Sc)**2+(dH/Sh)**2+Rt*(dC/Sc)*(dH/Sh))
D={
 'a':dict(surf=['#0B0D10','#14181D','#1B2027','#252B34'],tx='#F2F5F8',mu='#A9B2BE',acc=('#3D8BFF','#03101F'),
   macro=dict(cal='#ECEFF3',pro='#5C9DFF',carb='#33C7B8',fat='#F5A524')),
 'b':dict(surf=['#1B2128','#242B34','#2D3540'],tx='#F3F5F7',mu='#B2BCC7',acc=('#FF6B2C','#1C0800'),acc2=('#2F62E8','#FFFFFF'),
   macro=dict(cal='#FFC24B',pro='#7AA3FF',carb='#3DD68C',fat='#E58FB5')),
 'c':dict(surf=['#FFFFFF','#EDF0F4','#F5F7FA'],tx='#0B1424',mu='#4D5868',acc=('#1D3FE0','#FFFFFF'),
   macro=dict(cal='#0B1424',pro='#1D3FE0',carb='#0A7A4B',fat='#B5470B')),
}
ok=True
for k,d in D.items():
  print(f'== design {k}')
  for s in d['surf']:
    for n in ('tx','mu'):
      v=cr(d[n],s); print(f'  {n} on {s}: {v:.2f}'); ok&=v>=4.5
  for a in [x for x in (d.get('acc'),d.get('acc2')) if x]:
    v=cr(a[0],a[1]); print(f'  on-accent {a[1]} on {a[0]}: {v:.2f}'); ok&=v>=4.5
  m=d['macro']
  for (n1,c1),(n2,c2) in itertools.combinations(m.items(),2):
    e=de2000(c1,c2); print(f'  dE2000 {n1}/{n2}: {e:.1f}'); ok&=e>=20
  for n,c in m.items():
    w=min(cr(c,s) for s in d['surf']); print(f'  {n} {c} min contrast on surfaces: {w:.2f}'); ok&=w>=4.5
print('ALL PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
