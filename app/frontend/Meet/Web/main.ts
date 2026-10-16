import { mount } from 'svelte';
import MeetWeb from './MeetWeb.svelte';
import '../../app.css';
import '../../icon-motion.css';
import { installTooltips } from '../../Shared/tooltip';

installTooltips(document);

const app = mount(MeetWeb, {
  target: document.getElementById('app'),
});

export default app;
