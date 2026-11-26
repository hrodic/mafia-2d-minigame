function d(t,c,n,i,o){let e=t+Math.max(0,c),a=0;for(;e>=n&&a<i;)o(n),e-=n,a++;const r=a>=i&&e>=n;return r&&(e=0),{accumulator:e,steps:a,dropped:r}}export{d as advanceFixedStep};
