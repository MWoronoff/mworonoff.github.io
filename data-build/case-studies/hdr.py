"""Header photo: crop to the template's 990x640 frame, then fade from black on the left edge (behind the title)."""
from PIL import Image
import numpy as np, sys
def make(src, out, x0, y0, x1, flip=False, black=0.10, fade=0.42):
    im=Image.open(src).convert('RGB')
    if flip: im=im.transpose(Image.FLIP_LEFT_RIGHT)
    w=x1-x0; h=round(w*640/990)
    im=im.crop((x0,y0,x1,y0+h)).resize((990,640),Image.LANCZOS)
    a=np.asarray(im).astype(float); x=np.linspace(0,1,990)
    k=np.clip((x-black)/(fade-black),0,1); k=k*k*(3-2*k)   # smooth ramp: 0 = black, 1 = photo
    a=a*k[None,:,None]
    Image.fromarray(a.astype('uint8')).save(out,quality=92)
if __name__=='__main__':
    make(*sys.argv[1:3], *map(int,sys.argv[3:6]), flip=len(sys.argv)>6)
