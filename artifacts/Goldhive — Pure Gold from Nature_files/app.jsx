/* global React, ReactDOM, Icon, Bee, HoneyJar, TweaksPanel, TweakSection, TweakSlider, TweakToggle, useTweaks */
const { useEffect, useRef, useState } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "scrollBlur": true,
  "blurStrength": 6,
  "parallax": true,
  "beesEnabled": true
}/*EDITMODE-END*/;

/* =============== Reveal hook =============== */
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll(".reveal, .reveal-stagger");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -60px 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

/* =============== Nav =============== */
function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 30);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <nav className={`nav ${scrolled ? "scrolled" : ""}`}>
      <a href="#top" className="nav-logo">
        <span className="nav-logo-mark"><Icon.Hexagon size={22}/></span>
        Goldhive
      </a>
      <ul className="nav-links">
        <li><a href="#story">Story</a></li>
        <li><a href="#products">Honey</a></li>
        <li><a href="#process">Process</a></li>
        <li><a href="#testimonials">Reviews</a></li>
        <li><a href="#journal">Journal</a></li>
      </ul>
      <a href="#products" className="nav-cart">
        <Icon.Cart size={14}/>
        <span>Cart · 0</span>
      </a>
    </nav>
  );
}

/* =============== Hero =============== */
function Hero({ parallax = true }) {
  const heroRef = useRef(null);
  useEffect(() => {
    if (!parallax) {
      if (heroRef.current) {
        const inner = heroRef.current.querySelector(".hero-content");
        const sun = heroRef.current.querySelector(".hero-sun");
        if (inner) inner.style.transform = "";
        if (sun) sun.style.transform = "translateX(-50%)";
      }
      return;
    }
    const onScroll = () => {
      const y = window.scrollY;
      if (heroRef.current && y < 800) {
        const inner = heroRef.current.querySelector(".hero-content");
        if (inner) inner.style.transform = `translateY(${y * 0.25}px)`;
        const sun = heroRef.current.querySelector(".hero-sun");
        if (sun) sun.style.transform = `translateX(-50%) translateY(${y * 0.15}px)`;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [parallax]);

  return (
    <section className="hero" id="top" ref={heroRef}>
      <div className="hero-bg"/>
      <div className="hero-sun"/>
      <div className="hero-grain"/>
      <div className="honeycomb-bg"/>

      {/* Floating bees */}
      <div className="bee bee-1"><Bee size={36}/></div>
      <div className="bee bee-2"><Bee size={28}/></div>
      <div className="bee bee-3"><Bee size={32}/></div>

      {/* Honey drip from nav */}
      <div className="honey-drip" aria-hidden="true">
        <svg viewBox="0 0 80 240">
          <defs>
            <linearGradient id="dripGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F4CA53"/>
              <stop offset="100%" stopColor="#B87914"/>
            </linearGradient>
          </defs>
          <path d="M 30 0 Q 28 80 32 140 Q 34 180 40 200 Q 46 220 40 232 Q 34 220 36 210 Q 30 200 32 180 Q 28 140 26 80 Z" fill="url(#dripGrad)" opacity="0.85"/>
          <ellipse cx="40" cy="234" rx="6" ry="4" fill="#F4CA53" opacity="0.5"/>
        </svg>
      </div>

      <div className="hero-content">
        <div className="hero-eyebrow">
          <span>Estate · Apiary No. 07</span>
        </div>
        <h1>
          Pure Gold<br/>
          <span className="gold">from Nature</span>
        </h1>
        <p className="hero-sub">
          Raw, single-origin honey. Hand-harvested by three generations of beekeepers in the Cévennes hills, never heated, never blended.
        </p>
        <div className="hero-ctas">
          <a href="#products" className="btn btn-primary">
            Shop Honey <Icon.Arrow size={14}/>
          </a>
          <a href="#story" className="btn btn-ghost">Learn More</a>
        </div>
      </div>

      <div className="hero-meta">
        <div className="hero-meta-block">
          <span>EST. 1962</span>
          <span>Cévennes, FR</span>
        </div>
        <div className="hero-scroll">
          <span>Scroll</span>
          <div className="hero-scroll-line"/>
        </div>
        <div className="hero-meta-block" style={{ textAlign: "right" }}>
          <span>Harvest 26 / III</span>
          <span>4 Varietals</span>
        </div>
      </div>
    </section>
  );
}

/* =============== Story =============== */
function Story() {
  return (
    <section className="story section-pad" id="story">
      <div className="honeycomb-bg"/>
      <div className="story-grid">
        <div className="reveal">
          <div className="story-portrait">
            <div className="story-portrait-placeholder">
              <svg width="88" height="88" viewBox="0 0 88 88" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="44" cy="34" r="14"/>
                <path d="M16 78 Q16 56 44 56 Q72 56 72 78"/>
                <path d="M30 26 Q44 14 58 26" opacity="0.6"/>
              </svg>
              <div className="ph-label">Portrait · drop image here</div>
            </div>
            <div className="story-portrait-caption">
              <div className="l">FRAME 04 · F1.4<b>Henri Lavoisier</b></div>
              <div className="r">— 1 / 4</div>
            </div>
            <div className="story-portrait-frame"/>
          </div>
        </div>
        <div className="reveal">
          <div className="eyebrow">Three generations · One craft</div>
          <h2 className="section-title">
            A family that<br/>speaks <em>fluent bee.</em>
          </h2>
          <p className="section-lead">
            My grandfather kept seven hives behind the chestnut grove. Today we tend three hundred — across the same hills, the same wildflowers, the same patient rhythm. Nothing moves quickly here. The bees decided that long before we did.
          </p>
          <blockquote className="story-quote">
            "Good honey is not made. It is found, then trusted into a jar."
          </blockquote>
          <div className="story-sig">
            <div>
              <div className="story-sig-name">Henri Lavoisier</div>
              <div className="story-sig-role">Beekeeper · Third generation</div>
            </div>
          </div>
          <div className="story-stats">
            <div>
              <div className="story-stat-num">62</div>
              <div className="story-stat-label">Years on the land</div>
            </div>
            <div>
              <div className="story-stat-num">300</div>
              <div className="story-stat-label">Hives, hand-tended</div>
            </div>
            <div>
              <div className="story-stat-num">0</div>
              <div className="story-stat-label">Pesticides ever used</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* =============== Products =============== */
function Products() {
  const items = [
    {
      tone: "wildflower",
      tag: "Multi-Floral",
      name: <>The <em>Wildflower</em></>,
      desc: "Bright, balanced, with notes of clover and warm citrus blossom.",
      price: "€28",
      unit: "/ 350g",
    },
    {
      tone: "acacia",
      tag: "Mono-Floral",
      name: <>The <em>Acacia</em></>,
      desc: "Pale gold, almost translucent. Delicate, vanilla-soft, slow to crystallize.",
      price: "€34",
      unit: "/ 350g",
    },
    {
      tone: "forest",
      tag: "Wild Forest",
      name: <>The <em>Forest</em></>,
      desc: "Dark, woodsy, deeply mineral. Harvested high in the chestnut canopy.",
      price: "€42",
      unit: "/ 350g",
    },
  ];

  return (
    <section className="products section-pad" id="products">
      <div className="products-head">
        <div className="reveal">
          <div className="eyebrow">The Collection · 26 / III</div>
          <h2 className="section-title">Three jars,<br/>one valley.</h2>
        </div>
        <div className="reveal" style={{ maxWidth: 320 }}>
          <p style={{ color: "var(--cream-soft)", fontSize: 15, lineHeight: 1.6 }}>
            Every batch is poured by hand, sealed within hours of harvest, and labeled with the name of the beekeeper who walked it home.
          </p>
        </div>
      </div>

      <div className="products-grid reveal-stagger">
        {items.map((it, i) => (
          <article className="product-card" key={i}>
            <div className="product-jar">
              <HoneyJar tone={it.tone}/>
            </div>
            <div className="product-meta">
              <span className="product-tag">{it.tag}</span>
              <h3 className="product-name">{it.name}</h3>
              <p className="product-desc">{it.desc}</p>
              <div className="product-foot">
                <div className="product-price">
                  {it.price}<small>{it.unit}</small>
                </div>
                <button className="product-add" aria-label="Add to cart">
                  <Icon.Plus size={16}/>
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

/* =============== Process =============== */
function Process() {
  const steps = [
    { n: "01", icon: <Icon.Bee size={40}/>, title: "Free-roaming bees", desc: "Our colonies forage across 4,200 hectares of unsprayed wildflower, chestnut and lavender." },
    { n: "02", icon: <Icon.Hive size={40}/>, title: "Single-origin hives", desc: "Each frame is traced to one hive, one site, one season — never blended across regions." },
    { n: "03", icon: <Icon.Sun size={40}/>, title: "Cold-extracted, raw", desc: "Spun by hand at 28°C, gravity-filtered through linen. Enzymes and pollen left intact." },
    { n: "04", icon: <Icon.Leaf size={40}/>, title: "Ethically left behind", desc: "We harvest only the surplus. The colony eats first; we take what they can spare." },
  ];
  return (
    <section className="process section-pad" id="process">
      <div className="honeycomb-bg"/>
      <div style={{ maxWidth: 720 }} className="reveal">
        <div className="eyebrow">From flower to jar</div>
        <h2 className="section-title">Slow craft, <em>plainly told.</em></h2>
        <p className="section-lead">
          Four steps. No machinery between the hive and your spoon. This is how honey was made long before it became a commodity.
        </p>
      </div>
      <div className="process-grid reveal-stagger">
        {steps.map((s) => (
          <div className="process-cell" key={s.n}>
            <div className="process-num">{s.n} / 04</div>
            <div className="process-icon">{s.icon}</div>
            <div className="process-title">{s.title}</div>
            <div className="process-desc">{s.desc}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* =============== Drip break =============== */
function DripBreak() {
  return (
    <section className="drip-break">
      <div className="drip-bg"/>
      <div className="drip-strands">
        {Array.from({ length: 14 }).map((_, i) => (
          <div
            key={i}
            className="drip-strand"
            style={{
              height: `${30 + Math.random() * 50}%`,
              opacity: 0.3 + Math.random() * 0.6,
              filter: `blur(${Math.random() * 1.5}px)`,
            }}
          />
        ))}
      </div>
      <div className="drip-content reveal">
        <div className="eyebrow" style={{ justifyContent: "center" }}>Macro · 1 : 1.4</div>
        <h2 className="section-title">
          A spoonful is<br/><em>a year of weather.</em>
        </h2>
      </div>
    </section>
  );
}

/* =============== Testimonials =============== */
function Testimonials() {
  const items = [
    {
      stars: 5,
      text: "The acacia is the cleanest honey I've ever cooked with. It tastes like a Sunday morning.",
      name: "Camille Roux",
      role: "Chef · Maison Roux, Lyon",
      initial: "C",
    },
    {
      stars: 5,
      text: "I've sourced from a dozen French apiaries. Goldhive is the only one I now reorder by name.",
      name: "Daniel Okafor",
      role: "Pastry, Copenhagen",
      initial: "D",
    },
    {
      stars: 5,
      text: "It crystallized on my counter like it should. My grandmother would have approved — high praise.",
      name: "Iris Lehmann",
      role: "Verified buyer",
      initial: "I",
    },
  ];
  return (
    <section className="testimonials section-pad" id="testimonials">
      <div className="testimonials-head reveal">
        <div className="eyebrow">Tasting notes</div>
        <h2 className="section-title">Words from the table.</h2>
      </div>
      <div className="testimonials-grid reveal-stagger">
        {items.map((t, i) => (
          <div className="testimonial" key={i}>
            <div className="testimonial-quote-mark">"</div>
            <div className="stars">
              {Array.from({ length: t.stars }).map((_, j) => <Icon.Star key={j} size={13}/>)}
            </div>
            <p className="testimonial-text">{t.text}</p>
            <div className="testimonial-author">
              <div className="testimonial-avatar">{t.initial}</div>
              <div>
                <div className="testimonial-name">{t.name}</div>
                <div className="testimonial-role">{t.role}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* =============== CTA =============== */
function CTA() {
  return (
    <section className="cta">
      <div className="cta-inner reveal">
        <div className="cta-bg honeycomb-bg" style={{ opacity: 0.06 }}/>
        <div className="eyebrow" style={{ justifyContent: "center" }}>The Goldhive Promise</div>
        <h2>Taste the<br/><em>difference.</em></h2>
        <p>Every jar ships with the harvest date, hive coordinates, and the name of who poured it. If it isn't the finest honey you've tasted, send it back — keep the jar.</p>
        <div className="cta-ctas">
          <a href="#products" className="btn btn-primary">
            Order a Trio <Icon.Arrow size={14}/>
          </a>
          <a href="#story" className="btn btn-ghost">Visit the Apiary</a>
        </div>
        <div className="cta-trust">
          <div className="cta-trust-item"><Icon.Check size={14}/> Carbon-neutral shipping</div>
          <div className="cta-trust-item"><Icon.Check size={14}/> EU Organic certified</div>
          <div className="cta-trust-item"><Icon.Check size={14}/> 30-day taste guarantee</div>
        </div>
      </div>
    </section>
  );
}

/* =============== Footer =============== */
function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <div className="footer-brand-name">
            <Icon.Hexagon size={22}/> Goldhive
          </div>
          <p>Family-run apiary in the Cévennes mountains. Raw, single-origin honey since 1962. Three generations, one valley, no shortcuts.</p>
        </div>
        <div className="footer-col">
          <h4>Shop</h4>
          <ul>
            <li><a href="#products">Wildflower</a></li>
            <li><a href="#products">Acacia</a></li>
            <li><a href="#products">Forest</a></li>
            <li><a href="#products">Gift Trio</a></li>
          </ul>
        </div>
        <div className="footer-col">
          <h4>Estate</h4>
          <ul>
            <li><a href="#story">Our Story</a></li>
            <li><a href="#process">Process</a></li>
            <li><a href="#">Visit Us</a></li>
            <li><a href="#">Press</a></li>
          </ul>
        </div>
        <div className="footer-col">
          <h4>Contact</h4>
          <ul>
            <li><a href="#">hello@goldhive.fr</a></li>
            <li><a href="#">+33 4 66 00 00 00</a></li>
            <li><a href="#">Instagram</a></li>
            <li><a href="#">Newsletter</a></li>
          </ul>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© Goldhive Apiary · MMXXVI</span>
        <span>Cévennes National Park · France</span>
      </div>
    </footer>
  );
}

/* =============== App =============== */
function App() {
  useReveal();
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const blurRaf = useRef(0);
  const lastY = useRef(0);
  const lastT = useRef(performance.now());

  // Scroll-driven motion blur
  useEffect(() => {
    if (!t.scrollBlur) {
      document.documentElement.style.removeProperty("--scroll-blur");
      return;
    }
    const onScroll = () => {
      const now = performance.now();
      const dy = Math.abs(window.scrollY - lastY.current);
      const dt = Math.max(8, now - lastT.current);
      const v = dy / dt; // px/ms
      const blur = Math.min(t.blurStrength, v * 2.4);
      document.documentElement.style.setProperty("--scroll-blur", `${blur.toFixed(2)}px`);
      lastY.current = window.scrollY;
      lastT.current = now;

      cancelAnimationFrame(blurRaf.current);
      blurRaf.current = requestAnimationFrame(() => {
        // ease back to 0 when scrolling stops
        document.documentElement.style.setProperty("--scroll-blur", "0px");
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(blurRaf.current);
      document.documentElement.style.removeProperty("--scroll-blur");
    };
  }, [t.scrollBlur, t.blurStrength]);

  // Toggle parallax + bees via classes on root
  useEffect(() => {
    document.documentElement.classList.toggle("no-parallax", !t.parallax);
    document.documentElement.classList.toggle("no-bees", !t.beesEnabled);
  }, [t.parallax, t.beesEnabled]);

  return (
    <>
      <Nav/>
      <div className="motion-blur-wrap">
        <Hero parallax={t.parallax}/>
        <Story/>
        <Products/>
        <Process/>
        <DripBreak/>
        <Testimonials/>
        <CTA/>
        <Footer/>
      </div>
      <TweaksPanel>
        <TweakSection label="Motion"/>
        <TweakToggle
          label="Scroll motion blur"
          value={t.scrollBlur}
          onChange={(v) => setTweak("scrollBlur", v)}
        />
        <TweakSlider
          label="Blur strength"
          value={t.blurStrength}
          min={0} max={16} step={0.5} unit="px"
          onChange={(v) => setTweak("blurStrength", v)}
        />
        <TweakToggle
          label="Hero parallax"
          value={t.parallax}
          onChange={(v) => setTweak("parallax", v)}
        />
        <TweakToggle
          label="Floating bees"
          value={t.beesEnabled}
          onChange={(v) => setTweak("beesEnabled", v)}
        />
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
