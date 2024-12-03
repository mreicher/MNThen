// Dropdown functionality
function initializeDropdowns() {
  // Get all dropdown toggles
  const dropdowns = document.querySelectorAll('.nav-item.dropdown');
  
  dropdowns.forEach(dropdown => {
    const toggle = dropdown.querySelector('.dropdown-toggle');
    const menu = dropdown.querySelector('.dropdown-menu');
    
    if (!toggle || !menu) return;

    // Toggle dropdown on click
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Close other dropdowns
      dropdowns.forEach(other => {
        if (other !== dropdown) {
          other.querySelector('.dropdown-menu')?.classList.remove('show');
        }
      });
      
      // Toggle current dropdown
      menu.classList.toggle('show');
      
      // Handle arrow rotation
      const arrow = toggle.querySelector('.dropdown-arrow');
      if (arrow) {
        arrow.style.transform = menu.classList.contains('show') 
          ? 'rotate(180deg)' 
          : 'rotate(0deg)';
      }
    });
  });

  // Close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown')) {
      dropdowns.forEach(dropdown => {
        const menu = dropdown.querySelector('.dropdown-menu');
        const arrow = dropdown.querySelector('.dropdown-arrow');
        if (menu) menu.classList.remove('show');
        if (arrow) arrow.style.transform = 'rotate(0deg)';
      });
    }
  });

  // Handle mobile menu
  const navbarToggler = document.querySelector('.navbar-toggler');
  const navbarCollapse = document.querySelector('.navbar-collapse');
  
  if (navbarToggler && navbarCollapse) {
    navbarToggler.addEventListener('click', () => {
      navbarCollapse.classList.toggle('show');
    });

    // Close mobile menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.navbar-collapse') && 
          !e.target.closest('.navbar-toggler') && 
          navbarCollapse.classList.contains('show')) {
        navbarCollapse.classList.remove('show');
      }
    });
  }
}

// Initialize dropdowns when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeDropdowns);
