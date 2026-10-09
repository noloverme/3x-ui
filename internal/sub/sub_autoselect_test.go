package sub

import (
	"testing"
)

func TestAutoSelectClashGroups(t *testing.T) {
	svc := NewSubClashService(false, "", nil)

	// When autoSelect is disabled
	svc.SetAutoSelect(false, "Auto")
	if svc.autoSelect {
		t.Errorf("expected autoSelect false, got true")
	}

	// When autoSelect is enabled
	svc.SetAutoSelect(true, "My Fastest Server")
	if !svc.autoSelect {
		t.Errorf("expected autoSelect true, got false")
	}
	if svc.autoSelectTitle != "My Fastest Server" {
		t.Errorf("expected title 'My Fastest Server', got %q", svc.autoSelectTitle)
	}
}

func TestAutoSelectJsonService(t *testing.T) {
	svc := NewSubJsonService("", "", "", "", nil)

	svc.SetAutoSelect(true, "Автовыбор")
	if !svc.autoSelect {
		t.Errorf("expected autoSelect true, got false")
	}
	if svc.autoSelectTitle != "Автовыбор" {
		t.Errorf("expected title 'Автовыбор', got %q", svc.autoSelectTitle)
	}
}
